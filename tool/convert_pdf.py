import os
import sys
import json
import uuid
import hashlib
import argparse
import re
import concurrent.futures
import httpx
import time
from pydantic import BaseModel, Field
from typing import List, Optional
from google import genai
from google.genai import types

# ==========================================
# Pydantic Schemas for Step 1 & Step 2
# ==========================================

class TrackMetaModel(BaseModel):
    name: str = Field(description="The exact name of the track/category (e.g. 'All-camp Activities', 'General Daily Times', 'Pool', 'Athletics', 'Archery', 'Nature/Hiking', 'Arts and Crafts', 'Music', 'Cub Corral', 'Lair Yoga', 'Teddy Bears', 'Golden Bears', 'Cal Bears', 'Grizzly Bears'). Visual Grouping Rule: Look at the visual layout and headers of the document. If a table or grid section has an overarching heading/title (e.g., 'General Daily Times') and contains multiple sub-sections or rows grouped by a category in the first column or sub-headers (e.g., 'Meals', 'Burger Shack', 'Store', 'Medical'), do NOT extract each of those sub-sections/sub-groups as separate tracks. Instead, extract only the overarching section/track name.")
    banner: Optional[str] = Field(None, description="Any general policies, rules, warnings, or announcements listed under this track header (e.g. Pool adult swim rule, arts & crafts rules). Null if none.")

class ScheduleMetadata(BaseModel):
    year: int = Field(description="The year of the schedule (e.g. 2026)")
    camp: str = Field(description="The camp ID (blue, gold, oski) parsed from the document")
    week: int = Field(description="The week number parsed from the document")
    start_date: str = Field(description="The date of the Saturday check-in, formatted as YYYY-MM-DD (e.g. '2026-06-20')")
    tracks: List[TrackMetaModel] = Field(description="List of all tracks/categories that contain events or rules in the document")

class RawEventModel(BaseModel):
    raw_day: str = Field(description="The day of the week exactly as shown or implied for this event row in the schedule grid (e.g. 'Saturday', 'Sunday', 'Monday', 'Tuesday', etc.).")
    raw_time: str = Field(description="The raw time range text exactly as shown in the schedule (e.g. '2:30-4:00 PM', '7:15 AM', '9:00 AM - 12:00 PM', '10:00 AM', 'Sunday - Friday 7:15 AM').")
    title: str = Field(description="The title of the event.")
    location: Optional[str] = Field(None, description="The location of the event. If the location refers to one or more known map locations, format those parts of the text as a markdown link using the scheme 'maplocation://<camp_id>/<location_id>' (e.g. '[Volleyball Court](maplocation://oski/volleyball_court)'). Always capitalize the text of the link (e.g. use '[Pool]' instead of '[pool]'). Leave unrecognized parts or unlabeled locations as plain text, starting with an uppercase letter. Null if not specified.")
    description: Optional[str] = Field(None, description="Detailed description of the event. Preserve markdown formatting like bold text, lists, or italics.")

class RawTrackEvents(BaseModel):
    track_name: str = Field(description="The exact name of the track.")
    events: List[RawEventModel] = Field(description="List of raw events belonging to this track.")

class RawBatchExtraction(BaseModel):
    results: List[RawTrackEvents] = Field(description="List of raw extractions for each queried track.")

class TimeResolution(BaseModel):
    unique_id: int = Field(description="The sequential unique index of the event from the input list.")
    startTime: str = Field(description="ISO 8601 datetime format (e.g. '2026-06-20T15:00:00-07:00' with PDT -07:00 offset). You MUST zero-pad the hour, minute, and second values (e.g., use 'T02:30:00' instead of 'T2:30:00'). Mapped to the actual calendar day of the week based on Saturday check-in.")
    endTime: Optional[str] = Field(None, description="ISO 8601 datetime format with PDT -07:00 offset (e.g., '2026-06-20T17:30:00-07:00'). You MUST zero-pad the hour, minute, and second values (e.g., use 'T02:30:00' instead of 'T2:30:00'). Null if no end time is specified.")

class TimeResolutionResults(BaseModel):
    resolutions: List[TimeResolution] = Field(description="List of resolved date/time values.")

class LocationMapping(BaseModel):
    raw_location: str = Field(description="The exact raw location string from the input list.")
    mapped_location: Optional[str] = Field(None, description="The resolved location string. If any parts of raw_location correspond to one or more known map locations, format those parts as markdown links using the scheme 'maplocation://<camp_id>/<location_id>' (e.g., '[Pool](maplocation://gold/pool)'). A raw_location string may contain zero, one, or multiple locations (e.g., 'Kiddie Campfire / Dining Hall'). If none of the locations match, or if a location is not on the map, return the raw_location with no changes.")

class LocationResolutionResponse(BaseModel):
    mappings: List[LocationMapping]

# ==========================================
# Core Conversion Flow
# ==========================================

def load_map_locations() -> List[dict]:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    maps_dir = os.path.abspath(os.path.join(script_dir, "..", "..", "Lair", "assets", "maps"))
    
    locations_list = []
    if not os.path.exists(maps_dir):
        print(f"Warning: Maps directory not found at {maps_dir}")
        return locations_list
        
    for filename in os.listdir(maps_dir):
        if filename.startswith("locations_") and filename.endswith(".json"):
            camp_name = filename[10:-5]  # e.g. "oski", "blue", "gold", "overall"
            filepath = os.path.join(maps_dir, filename)
            try:
                with open(filepath, "r") as f:
                    data = json.load(f)
                    for loc in data.get("locations", []):
                        loc_id = loc.get("id")
                        name = loc.get("name")
                        if loc_id and name:
                            locations_list.append({
                                "id": f"{camp_name}/{loc_id}",
                                "name": name
                            })
            except Exception as e:
                print(f"Error loading map location file {filename}: {e}")
    return locations_list

def _format_location_link(match) -> str:
    label = match.group(1)
    rest = match.group(2)
    capitalized_label = ' '.join(word[0].upper() + word[1:] if len(word) > 0 else '' for word in label.split(' '))
    return f"[{capitalized_label}]({rest})"

def clean_location(loc: Optional[str]) -> Optional[str]:
    if not loc:
        return loc
    
    # Capitalize markdown link labels (e.g. [pool](...) -> [Pool](...))
    loc = re.sub(r'\[([^\]]+)\]\((maplocation://[^)]+)\)', _format_location_link, loc)
    
    # Ensure the first letter of the location string is capitalized
    if loc and loc[0].islower():
        loc = loc[0].upper() + loc[1:]
    elif loc and loc.startswith('[') and len(loc) > 1 and loc[1].islower():
        loc = '[' + loc[1].upper() + loc[2:]
        
    return loc

def clean_description(desc: Optional[str]) -> Optional[str]:
    if not desc:
        return desc
    return re.sub(r'\[([^\]]+)\]\((maplocation://[^)]+)\)', _format_location_link, desc)


def get_camp_aliases_prompt(camp: str) -> str:
    if camp == "oski":
        return """
Aliases:
- 'Stage' or 'Oski Stage' -> 'oski/papa_bear_stage'
- 'Dining Hall' or 'Oski Dining Hall' -> 'oski/lodge'
- 'Lair Lodge' or 'Lodge' -> 'oski/lodge'
- 'Volleyball Court' or 'Oski Volleyball Court' -> 'oski/volleyball_court'
- 'Gaga Pit' -> 'gold/gaga_ball'
- 'Wellness Center' -> 'gold/wellness_center'
- 'Vista Lodge' or 'Vista Lounge' -> 'gold/vista_lodge'
- 'Teen Lodge' -> 'gold/teen_lodge'
- 'Bruised Bears Building' or 'Bruised Bears' -> 'gold/wounded_bears'
- 'Gold Pool' -> 'gold/pool'
- 'Gold Softball Field' or 'Softball Field' -> 'gold/sports_courts'
"""
    elif camp == "blue":
        return """
Aliases:
- 'Stage' or 'Blue Stage' -> 'blue/stage'
- 'Dining Hall' or 'Blue Dining Hall' -> 'blue/dining_hall'
- 'Lodge' or 'Blue Lodge' -> 'blue/lodge'
- 'Volleyball Court' -> 'blue/sports_courts'
- 'Gaga Pit' -> 'gold/gaga_ball'
- 'Wellness Center' -> 'gold/wellness_center'
- 'Vista Lodge' -> 'gold/vista_lodge'
- 'Teen Lodge' -> 'gold/teen_lodge'
- 'Bruised Bears Building' -> 'gold/wounded_bears'
- 'Gold Pool' -> 'gold/pool'
"""
    elif camp == "gold":
        return """
Aliases:
- 'Stage' or 'Gold Stage' -> 'gold/stage'
- 'Dining Hall' or 'Gold Dining Hall' -> 'gold/dining_hall'
- 'Lodge' or 'Gold Lodge' -> 'gold/lodge'
- 'Volleyball Court' -> 'gold/sports_courts'
- 'Gaga Pit' -> 'gold/gaga_ball'
- 'Wellness Center' -> 'gold/wellness_center'
- 'Vista Lodge' -> 'gold/vista_lodge'
- 'Teen Lodge' -> 'gold/teen_lodge'
- 'Bruised Bears Building' -> 'gold/wounded_bears'
- 'Gold Pool' -> 'gold/pool'
"""
    return ""


def apply_mappings_to_text(text: str, mapping: dict) -> str:
    if not text:
        return text
    sorted_keys = sorted(mapping.keys(), key=len, reverse=True)
    for key in sorted_keys:
        val = mapping[key]
        if val and val != key:
            # Match existing markdown links or the target raw location
            pattern = r'(\[[^\]]+\]\([^)]+\))|(\b' + re.escape(key) + r'\b)'
            def repl(match):
                if match.group(1):
                    return match.group(1)
                return val
            text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
    return text


def extract_plain_text_location(loc: str) -> str:
    if not loc:
        return ""
    # Strip any markdown links to just their label
    return re.sub(r'\[([^\]]+)\]\((maplocation://[^)]+)\)', r'\1', loc)

def fix_timestamp_format(ts: Optional[str]) -> Optional[str]:
    if not ts:
        return ts
    # Match date, T, then 1-2 digits for hour, optional colon/mins/secs/timezone
    match = re.match(r"^(\d{4}-\d{2}-\d{2})T(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s*(?:-[07]{4}|-07:00))?$", ts.strip())
    if not match:
        return ts
    date_part, hour_part, min_part, sec_part = match.groups()
    sec_part = sec_part or "00"
    hour = int(hour_part)
    return f"{date_part}T{hour:02d}:{min_part}:{sec_part}-07:00"

def call_gemini_with_retry(api_call_fn, max_retries=3):
    from google.genai import errors as genai_errors
    for attempt in range(max_retries):
        try:
            return api_call_fn()
        except genai_errors.APIError as e:
            # Retry only on rate limits (429) or server errors (>= 500)
            if e.status_code == 429 or (e.status_code and e.status_code >= 500):
                if attempt == max_retries - 1:
                    raise e
                wait_time = 2 ** attempt
                print(f"Gemini API error (Status {e.status_code}): {e.message}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                # Permanent error (e.g. 400, 403, 404), do not retry
                raise e
        except (httpx.HTTPError, ConnectionError, TimeoutError) as e:
            # Network-level transient issue (timeout, reset, etc.)
            if attempt == max_retries - 1:
                raise e
            wait_time = 2 ** attempt
            print(f"Network error ({type(e).__name__}): {e}. Retrying in {wait_time}s...")
            time.sleep(wait_time)

def convert_pdf(pdf_path: str, dry_run: bool):
    # Parse metadata from path
    path_match = re.match(r'.*schedules/(\d{4})/([^/]+)/week_(\d+)\.pdf$', pdf_path)
    if not path_match:
        print(f"Error: Invalid PDF path format '{pdf_path}'. Expected schedules/{{year}}/{{camp}}/week_{{week}}.pdf")
        sys.exit(1)
    
    path_year = int(path_match.group(1))
    path_camp = path_match.group(2).lower()
    path_week = int(path_match.group(3))
    
    print(f"Processing {pdf_path} (Detected: Year {path_year}, Camp {path_camp}, Week {path_week})")
    
    if not os.path.exists(pdf_path):
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)
        
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        if os.path.exists(".tmp/api_key.txt"):
            with open(".tmp/api_key.txt", "r") as f:
                api_key = f.read().strip()
        elif os.path.exists(".env"):
            with open(".env", "r") as f:
                for line in f:
                    match = re.match('^\\s*GEMINI_API_KEY\\s*=\\s*["\']?([^#"\']*)["\']?', line)
                    if match:
                        api_key = match.group(1).strip()
                        break
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable is not set and no key found in .tmp/api_key.txt or .env.")
        sys.exit(1)

    print("Loading map locations from Lair...")
    known_locations = load_map_locations()
    print(f"Loaded {len(known_locations)} known map locations.")

    print("Reading PDF file as bytes...")
    with open(pdf_path, 'rb') as f:
        pdf_bytes = f.read()
    pdf_part = types.Part.from_bytes(
        data=pdf_bytes,
        mime_type='application/pdf'
    )

    client = genai.Client(api_key=api_key)
    model_name = 'gemini-3.5-flash'

    # ----------------------------------------------------
    # Step 1: Extract Active Tracks & Metadata
    # ----------------------------------------------------
    print("\n--- STEP 1: Extracting Schedule Metadata & Active Tracks ---")
    prompt1 = (
        "You are an expert schedule extraction assistant. Read the provided camp schedule PDF "
        "and extract the year, camp name, week number, and Saturday check-in date (YYYY-MM-DD).\n"
        "Also, identify all active tracks/categories (e.g. 'All-camp Activities', 'General Daily Times', 'Pool', 'Arts and Crafts', 'Teddy Bears', etc.) "
        "that have scheduled events or warnings, along with any track-level banner/policy announcements.\n\n"
        "Visual Grouping Rule: Look at the visual layout and headers of the document. If a table or grid section "
        "has an overarching heading/title (e.g., 'General Daily Times') and contains multiple sub-sections or rows "
        "grouped by a category in the first column or sub-headers (e.g., 'Meals', 'Burger Shack', 'Store', 'Medical'), "
        "do NOT extract each of those sub-sections/sub-groups as separate tracks. Instead, extract only the overarching "
        "section name (e.g., 'General Daily Times') as a single active track.\n\n"
        f"Expected: Year {path_year}, Camp {path_camp}, Week {path_week}."
    )
    
    response1 = call_gemini_with_retry(lambda: client.models.generate_content(
        model=model_name,
        contents=[pdf_part, prompt1],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ScheduleMetadata,
            temperature=0.1,
        ),
    ))
    
    metadata = ScheduleMetadata.model_validate_json(response1.text)
    
    year = metadata.year
    camp = metadata.camp.lower()
    week = metadata.week
    start_date = metadata.start_date
    detected_tracks = metadata.tracks

    print(f"Successfully extracted metadata:")
    print(f"  - Year: {year}")
    print(f"  - Camp: {camp}")
    print(f"  - Week: {week}")
    print(f"  - Saturday Check-in: {start_date}")
    print(f"  - Detected Tracks: {[t.name for t in detected_tracks]}")

    # ----------------------------------------------------
    # Step 2: Concurrently Extract Events in Batches
    # ----------------------------------------------------
    print("\n--- STEP 2: Extracting Events Concurrently in Batches ---")
    
    def extract_batch(batch_tracks: List[str]) -> List[RawTrackEvents]:
        track_names_str = ", ".join(f"'{name}'" for name in batch_tracks)
        print(f"Starting extraction for batch: {batch_tracks}")
        thread_client = genai.Client(api_key=api_key)
        prompt2 = (
            "You are an expert schedule extraction assistant.\n"
            f"Extract all events belonging to the following tracks: [{track_names_str}] from the provided PDF schedule.\n\n"
            "Format your JSON response as a dictionary containing a single key 'results', which is a list of objects. "
            "Each object represents a track and must have keys 'track_name' and 'events'. "
            "Each event object in the 'events' list MUST have exactly the following keys: 'raw_day', 'raw_time', 'title', 'location', 'description'. "
            "Do not use other keys like 'day' or 'event'.\n\n"
            "Rules:\n"
            "1. Strict Track Membership: You must associate events with their respective tracks strictly based on the physical visual layout "
            "(e.g., column, grid cell, or row boundaries) in the PDF. Do NOT assign an event to a track based on semantic association "
            "(for example, do not include dining, kitchen, or meal-related meetings under 'All-camp Activities' "
            "unless they are physically drawn inside that track's column/section of the grid).\n"
            "2. Group only events for these specific tracks. Omit events that physically belong to other tracks.\n"
            "3. Raw Day and Time: Extract the raw day of the week (e.g. 'Monday', 'Tuesday') and the raw time text exactly as shown "
            "in the schedule grid (e.g. '2:30-4:00 PM', '7:15 AM', '9:00 AM - 12:00 PM'). Do NOT convert these to ISO timestamps or do any date calculations.\n"
            "4. Expand recurring events (e.g. daily store hours or daily meals) into individual daily entries. Do not generate or expand daily events for the arrival Saturday before the official check-in begins, or for the departure Saturday after the official check-out time.\n"
            "5. Split events with multiple daily times (e.g. '9:00 AM & 2:00 PM') into separate events.\n"
            "6. Omit non-event text blocks like Land Acknowledgements.\n"
            "7. Preserve the ENTIRE pdf event description when creating the json event description, including markdown formatting like bold text or list items. Do NOT modify, shorten, truncate, or remove any text from the description, even if the event title or location already includes or repeats that information.\n"
            "8. Markdown Escaping: If the source PDF contains literal characters like asterisks (e.g. '*' or '**'), underscores ('_'), "
            "or backticks ('`') that are part of the literal text and not meant as markdown styling, you must escape them (e.g. '\\*', '\\*\\*', '\\_', '\\`') "
            "so they are not interpreted as markdown formatting by the app's renderer.\n"
            f"9. The 'track_name' field for each entry in 'results' must exactly match one of: {track_names_str}.\n"
            "10. Visual Grouping and Sub-categories: If a track is visually grouped or sub-categorized by a label in the first column, "
            "row header, or cell of the grid (for example, rows in 'General Daily Times' grouped by labels like 'MEALS', 'STORE', 'Burger Shack', 'MEDICAL', 'WELLNESS CENTER / MASSAGE', etc.), "
            "you must incorporate the group/category label into the event's title. Format the title as: '{Group Name}: {Event Title}', "
            "converting the group name to Title Case (e.g., 'Meals: Breakfast Buffet', 'Burger Shack: Evening Hours', 'Store: Sunday - Friday'). "
            "Do not extract the group label as a separate track name.\n"
            "11. Time-Only Extraction: Only extract a row, block, or cell from the PDF as an event if it contains an explicit, scheduled time or time range in the document's designated time column or grid cell. Do not extract general description blocks, booking instructions, or policy announcements as events if they do not have a scheduled time associated with them.\n"
        )

        response2 = call_gemini_with_retry(lambda: thread_client.models.generate_content(
            model=model_name,
            contents=[pdf_part, prompt2],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=RawBatchExtraction,
                temperature=0.1,
            ),
        ))

        try:
            batch_data = RawBatchExtraction.model_validate_json(response2.text)
            return batch_data.results
        except Exception as e:
            print(f"Validation error for batch {batch_tracks}: {e}")
            print(f"Response text: {response2.text}")
            raise e

    batch_size = 1
    track_names = [t.name for t in detected_tracks]
    batches = [track_names[i:i + batch_size] for i in range(0, len(track_names), batch_size)]
    
    extracted_events_by_track = {name: [] for name in track_names}

    if not batches:
        print("Warning: No tracks detected to extract.")
    else:
        print(f"Running {len(batches)} Stage 1 extraction batches sequentially...")
        for batch in batches:
            try:
                results = extract_batch(batch)
            except Exception as e:
                print(f"Error extracting batch {batch}: {e}")
                raise e
                
            for track_events in results:
                t_name = track_events.track_name
                # Case-insensitive recovery
                if t_name not in extracted_events_by_track:
                    closest = next((name for name in track_names if name.lower() == t_name.lower()), None)
                    if closest:
                        t_name = closest
                    else:
                        print(f"Warning: Received unexpected track name '{t_name}' in batch {batch}")
                        continue
                
                print(f"  - Batch result received for track '{t_name}': {len(track_events.events)} events.")
                extracted_events_by_track[t_name] = track_events.events

    # ----------------------------------------------------
    # Stage 2: Batch Time Resolution
    # ----------------------------------------------------
    print("\n--- STAGE 2: Batch Time Resolution ---")
    
    # Collect all events and assign them a unique ID
    all_raw_events = []
    unique_id_map = {}  # (track_name, index) -> unique_id
    
    unique_counter = 0
    for track_name in track_names:
        events = extracted_events_by_track.get(track_name, [])
        for i, event in enumerate(events):
            all_raw_events.append({
                "unique_id": unique_counter,
                "raw_day": event.raw_day,
                "raw_time": event.raw_time,
                "title": event.title
            })
            unique_id_map[(track_name, i)] = unique_counter
            unique_counter += 1
            
    resolved_times = {}
    if all_raw_events:
        time_batch_size = 40
        time_batches = [all_raw_events[i:i + time_batch_size] for i in range(0, len(all_raw_events), time_batch_size)]
        
        print(f"Resolving timestamps for {len(all_raw_events)} events in {len(time_batches)} batches...")
        
        def resolve_time_batch(batch_events):
            thread_client = genai.Client(api_key=api_key)
            prompt3 = (
                "You are a precise datetime calculation assistant.\n"
                f"Given the Saturday check-in date '{start_date}', convert the raw day and time values "
                "for each event into structured ISO 8601 timestamps in the PDT timezone (-07:00 offset).\n\n"
                "Rules:\n"
                "1. Saturday check-in is day 0 (e.g. if start_date is '2026-06-20', Saturday check-in events start on '2026-06-20').\n"
                "2. Map day names to the correct calendar date relative to start_date:\n"
                "   - Saturday -> Day 0 (start_date)\n"
                "   - Sunday -> Day 1\n"
                "   - Monday -> Day 2\n"
                "   - Tuesday -> Day 3\n"
                "   - Wednesday -> Day 4\n"
                "   - Thursday -> Day 5\n"
                "   - Friday -> Day 6\n"
                "   - Next Saturday -> Day 7\n"
                "3. Time Range PM Resolution: When a time range is specified with a meridian marker at the end (e.g. '3:30-4:30 PM' or '1:30-4:00 PM' or '2:30-4:00 PM'), both the start and end times inherit the same marker (PM in this case) unless explicitly specified otherwise. For example, '3:30-4:30 PM' must be parsed as 15:30:00 to 16:30:00, and '2:30-4:00 PM' must be parsed as 14:30:00 to 16:00:00.\n"
                "4. 24-Hour Time Conversion: Convert PM times to 24-hour format: 12:00 PM -> 12:00, 1:00 PM -> 13:00, 1:30 PM -> 13:30, 2:00 PM -> 14:00, 2:30 PM -> 14:30, 3:00 PM -> 15:00, 3:30 PM -> 15:30, 4:00 PM -> 16:00, 4:30 PM -> 16:30, 5:00 PM -> 17:00, 6:00 PM -> 18:00, 7:00 PM -> 19:00, 8:00 PM -> 20:00, 9:00 PM -> 21:00, 10:00 PM -> 22:00, 11:00 PM -> 23:00. DO NOT write hour values greater than 23 (e.g., never write 24:30:00; 2:30 PM is 14:30:00).\n"
                "5. Zero-Padding Hours: All hour parts in ISO 8601 strings MUST be zero-padded to two digits (e.g. '01', '02', '03', ..., '09', '10', '11', ...). Never output single-digit hours like 'T2:30:00' or 'T9:45:00'; they must be 'T02:30:00' and 'T09:45:00'.\n"
                "6. Camp activities take place during the day. Daytime events (like arts and crafts, hikes, or sports) that occur in the afternoon (e.g., '1:30 PM', '2:30 PM') must never be mapped to early morning hours like '01:30:00' or '02:30:00' (which would mean 1:30 AM or 2:30 AM, when campers are asleep). Always convert afternoon/evening times to 24-hour format (e.g. 1:30 PM is '13:30:00', 2:30 PM is '14:30:00'). Double-check that daytime program hours fall between 07:00:00 and 23:00:00.\n"
                "7. Output a result for EVERY single input item in the list, preserving its unique_id.\n\n"
                f"Events to resolve:\n{json.dumps(batch_events, indent=2)}"
            )
            
            response3 = call_gemini_with_retry(lambda: thread_client.models.generate_content(
                model=model_name,
                contents=[prompt3],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=TimeResolutionResults,
                    temperature=0.1,
                    max_output_tokens=8192,
                    thinking_config=types.ThinkingConfig(
                        thinking_budget=1024
                    )
                )
            ))
            
            try:
                return TimeResolutionResults.model_validate_json(response3.text).resolutions
            except Exception as e:
                print(f"Validation error for resolve time batch: {e}")
                print(f"Response text: {response3.text}")
                raise e

        for tb in time_batches:
            try:
                resolutions = resolve_time_batch(tb)
                for res in resolutions:
                    clean_start = fix_timestamp_format(res.startTime)
                    clean_end = fix_timestamp_format(res.endTime)
                    resolved_times[res.unique_id] = (clean_start, clean_end)
            except Exception as e:
                print(f"Error resolving time batch: {e}")
                raise e

    # ----------------------------------------------------
    # Step 3: Resolve Locations (Pass 2)
    # ----------------------------------------------------
    print("\n--- STEP 3: Resolving Locations (Pass 2) ---")
    all_raw_locations = set()
    for track_name, events in extracted_events_by_track.items():
        for event in events:
            if event.location:
                # Extract the plain text (strip any existing markdown links)
                plain_loc = extract_plain_text_location(event.location).strip()
                if plain_loc:
                    all_raw_locations.add(plain_loc)

    raw_locations_list = sorted(list(all_raw_locations))
    resolved_map = {}
    if not raw_locations_list:
        print("No raw locations to resolve.")
    else:
        print(f"Resolving {len(raw_locations_list)} unique raw locations...")
        aliases_text = get_camp_aliases_prompt(camp)
        prompt4 = (
            "You are an expert location-to-map linking assistant.\n"
            "Given a list of unique location strings extracted from a camp schedule, "
            "and a list of known map location IDs and their names, your job is to "
            "map the locations in the input list to their correct maplocation markdown links.\n\n"
            "Rules:\n"
            "1. Link Format: Use the scheme 'maplocation://<camp_id>/<location_id>'. E.g., '[Volleyball Court](maplocation://oski/volleyball_court)'.\n"
            "2. Multiple Locations: A single raw location string may contain more than one location (e.g., 'Kiddie Campfire / Dining Hall' or 'Gold Pool / Gaga Pit'). "
            "You must format all recognized map locations as links (e.g., '[Kiddie Campfire](maplocation://oski/kiddie_campfire) / [Dining Hall](maplocation://oski/lodge)').\n"
            "3. Unknown Locations: If a location is not on the map or unrecognized, leave it as plain text. Do not make up map links.\n"
            f"4. Camp Context: The schedule we are processing is for Camp {camp}.\n"
            "5. Cross-Camp Mapping: Events in one camp may occur at another camp. Map them to that other camp if applicable (e.g., 'Wellness Center' or 'Vista Lodge' in an Oski schedule should map to Gold camp locations).\n"
            "6. Aliases and Specific Mappings:\n"
            f"{aliases_text}\n"
            "Here is the list of known location IDs and their human-readable names:\n"
            f"{json.dumps(known_locations, indent=2)}\n\n"
            "Here are the raw location strings to resolve:\n"
            f"{json.dumps(raw_locations_list, indent=2)}"
        )
        
        response4 = client.models.generate_content(
            model=model_name,
            contents=[prompt4],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=LocationResolutionResponse,
                temperature=0.1,
            ),
        )
        
        resolution_data = LocationResolutionResponse.model_validate_json(response4.text)
        for item in resolution_data.mappings:
            if item.mapped_location:
                resolved_map[item.raw_location] = item.mapped_location
                print(f"  Mapped: '{item.raw_location}' -> '{item.mapped_location}'")
            else:
                print(f"  Unmapped: '{item.raw_location}'")

    final_tracks = []
    # Build final list in original track order
    for track_meta in detected_tracks:
        track_name = track_meta.name
        banner = track_meta.banner
        events = extracted_events_by_track.get(track_name, [])
        
        processed_events = []
        for i, event in enumerate(events):
            uid = unique_id_map.get((track_name, i))
            startTime, endTime = resolved_times.get(uid, ("", None))
            
            # Fallback if empty (should never happen)
            if not startTime:
                # Default to start_date T00:00:00
                startTime = f"{start_date}T00:00:00-07:00"
            
            raw_loc = event.location
            # If the location is already a link, we can keep it as is, or apply new mappings
            # Let's extract its plain text first to see if we mapped that plain text in Step 3
            plain_loc = extract_plain_text_location(raw_loc) if raw_loc else None
            mapped_loc = resolved_map.get(plain_loc, raw_loc) if plain_loc else raw_loc
            
            if mapped_loc == raw_loc and raw_loc:
                # In case of sub-parts or description, apply the mapping via string replacement
                mapped_loc = apply_mappings_to_text(raw_loc, resolved_map)
                
            raw_desc = event.description
            mapped_desc = apply_mappings_to_text(raw_desc, resolved_map) if raw_desc else raw_desc
            
            val = f"{event.title}_{startTime}_{track_name}"
            evt_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, val))
            
            processed_evt = {
                "id": evt_id,
                "startTime": startTime,
                "endTime": endTime,
                "title": event.title,
                "location": clean_location(mapped_loc),
                "description": clean_description(mapped_desc)
            }
            processed_events.append(processed_evt)

        # Sort events chronologically by startTime, then by title
        processed_events.sort(key=lambda x: (x.get("startTime", ""), x.get("title", "")))

        # Normalize track names (e.g. "All Camp Activities" -> "All-camp Activities")
        normalized_track_name = re.sub(r'(?i)\ball\s+camp\b', 'All-camp', track_name)

        final_tracks.append({
            "name": normalized_track_name,
            "banner": banner,
            "events": processed_events
        })

    final_json_data = {
        "tracks": final_tracks
    }

    # ----------------------------------------------------
    # Step 3: Write Output & Update Manifest
    # ----------------------------------------------------
    if dry_run:
        output_json_path = pdf_path.replace(".pdf", "_test.json")
        print(f"\nDry-run mode active. Writing output to: {output_json_path}")
    else:
        output_json_path = pdf_path.replace(".pdf", ".json")
        print(f"\nWriting output to: {output_json_path}")
        
    with open(output_json_path, "w") as f:
        json.dump(final_json_data, f, indent=2)
        
    if not dry_run:
        hash_md5 = hashlib.md5()
        with open(output_json_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        version_hash = hash_md5.hexdigest()[:8]
        print(f"Generated MD5 version hash: {version_hash}")
        
        manifest_path = "schedules/manifest.json"
        print(f"Updating {manifest_path}...")
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
            
        relative_file_path = output_json_path
        if relative_file_path.startswith("schedules/"):
            relative_file_path = relative_file_path[10:]
            
        entry_found = False
        for entry in manifest.get("schedules", []):
            if entry.get("year") == path_year and entry.get("camp") == path_camp and entry.get("week") == path_week:
                entry["file"] = relative_file_path
                entry["version"] = version_hash
                entry_found = True
                break
                
        if not entry_found:
            manifest.setdefault("schedules", []).append({
                "year": path_year,
                "camp": path_camp,
                "week": path_week,
                "file": relative_file_path,
                "version": version_hash
            })
            
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)
            
        print("Successfully updated manifest.json.")
    print("Done!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert schedule PDF to nested-track JSON using Google GenAI SDK.")
    parser.add_argument("pdf_path", nargs="?", help="Path to the PDF file (e.g. schedules/2026/oski/week_03.pdf)")
    parser.add_argument("--all", action="store_true", help="Scan schedules/ directory and convert all missing PDFs")
    parser.add_argument("--dry-run", action="store_true", help="Perform extraction without modifying manifest or overwrite original files")
    
    args = parser.parse_args()
    
    if args.all:
        import glob
        pdf_files = glob.glob("schedules/**/*.pdf", recursive=True)
        pdf_files = sorted(pdf_files)
        
        converted_count = 0
        for pdf_path in pdf_files:
            json_path = pdf_path.replace(".pdf", ".json")
            if os.path.exists(json_path):
                print(f"Skipping {pdf_path} (JSON already exists)")
                continue
                
            # Convert
            convert_pdf(pdf_path, args.dry_run)
            converted_count += 1
            
        print(f"\nBulk conversion complete. Converted {converted_count} files.")
    elif args.pdf_path:
        convert_pdf(args.pdf_path, args.dry_run)
    else:
        parser.print_help()
        sys.exit(1)
