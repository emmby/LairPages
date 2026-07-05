import os
import sys
import json
import uuid
import hashlib
import argparse
import re
import concurrent.futures
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

class EventModel(BaseModel):
    startTime: str = Field(description="ISO 8601 datetime format (e.g. '2026-06-20T15:00:00-07:00' with PDT -07:00 offset). You MUST zero-pad the hour, minute, and second values (e.g., use 'T02:30:00' instead of 'T2:30:00'). Mapped to the actual calendar day of the week based on Saturday check-in.")
    endTime: Optional[str] = Field(None, description="ISO 8601 datetime format with PDT -07:00 offset (e.g., '2026-06-20T17:30:00-07:00'). You MUST zero-pad the hour, minute, and second values (e.g., use 'T02:30:00' instead of 'T2:30:00'). Null if no end time is specified.")
    title: str = Field(description="The title of the event.")
    location: Optional[str] = Field(None, description="The location of the event. If the location refers to one or more known map locations, format those parts of the text as a markdown link using the scheme 'maplocation://<camp_id>/<location_id>' (e.g. '[Volleyball Court](maplocation://oski/volleyball_court)'). Always capitalize the text of the link (e.g. use '[Pool]' instead of '[pool]'). Leave unrecognized parts or unlabeled locations as plain text, starting with an uppercase letter. Null if not specified.")
    description: Optional[str] = Field(None, description="Detailed description of the event. Preserve markdown formatting like bold text, lists, or italics.")

class TrackEvents(BaseModel):
    track_name: str = Field(description="The exact name of the track.")
    events: List[EventModel] = Field(description="List of events belonging to this track.")

class BatchExtraction(BaseModel):
    results: List[TrackEvents] = Field(description="List of extractions for each queried track.")

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
    
    response1 = client.models.generate_content(
        model=model_name,
        contents=[pdf_part, prompt1],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ScheduleMetadata,
            temperature=0.1,
        ),
    )
    
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
    
    def extract_batch(batch_tracks: List[str]) -> List[TrackEvents]:
        track_names_str = ", ".join(f"'{name}'" for name in batch_tracks)
        print(f"Starting extraction for batch: {batch_tracks}")
        prompt2 = (
            "You are an expert schedule extraction assistant.\n"
            f"Extract all events belonging to the following tracks: [{track_names_str}] from the provided PDF schedule.\n\n"
            "Rules:\n"
            "1. Strict Track Membership: You must associate events with their respective tracks strictly based on the physical visual layout "
            "(e.g., column, grid cell, or row boundaries) in the PDF. Do NOT assign an event to a track based on semantic association "
            "or topical relevance (for example, do not include dining, kitchen, or meal-related meetings under 'All-camp Activities' "
            "unless they are physically drawn inside that track's column/section of the grid).\n"
            "2. Group only events for these specific tracks. Omit events that physically belong to other tracks.\n"
            "3. Map day names (Saturday, Sunday, Monday, etc.) to absolute ISO 8601 dates starting from the Saturday check-in date "
            f"'{start_date}' (PDT timezone offset -07:00, e.g., '2026-06-20T15:00:00-07:00'). You MUST zero-pad the hour, minute, and second values (e.g., use 'T02:30:00' instead of 'T2:30:00').\n"
            "4. Expand recurring events (e.g. daily store hours or daily meals) into individual daily entries.\n"
            "5. Split events with multiple daily times (e.g. '9:00 AM & 2:00 PM') into separate events.\n"
            "6. Omit non-event text blocks like Land Acknowledgements.\n"
            "7. Preserve the ENTIRE pdf event description when creating the json event description, including markdown formatting like bold text or list items. Do NOT modify, shorten, truncate, or remove any text from the description, even if the event title or location already includes or repeats that information.\n"
            "8. Markdown Escaping: If the source PDF contains literal characters like asterisks (e.g. '*' or '**'), underscores ('_'), "
            "or backticks ('`') that are part of the literal text and not meant as markdown styling, you must escape them (e.g. '\\*', '\\*\\*', '\\_', '\\`') "
            "so they are not interpreted as markdown formatting by the app's renderer.\n"
            f"9. The 'track_name' field for each entry in 'results' must exactly match one of: {track_names_str}.\n"
            "10. Location Mapping: For the event's location text, match it against the known map locations list below. "
            "Each known location in the list below has an 'id' containing '<camp_id>/<location_id>' (for example, 'gold/lodge' has camp_id 'gold' and location_id 'lodge'). "
            "If a location refers to one or more known map locations, format that part of the text as an inline markdown link "
            "using the scheme 'maplocation://<camp_id>/<location_id>'. For example, map 'Volleyball Court' to '[Volleyball Court](maplocation://oski/volleyball_court)'. "
            "Be careful NOT to duplicate the camp_id (e.g., do NOT write 'maplocation://gold/gold/lodge'; format it as 'maplocation://gold/lodge'). "
            "If an event lists multiple locations (e.g., 'Lair Lodge / Volleyball Court'), link all matching locations: '[Lair Lodge](maplocation://oski/lodge) / [Volleyball Court](maplocation://oski/volleyball_court)'. "
            "If a location doesn't match any known ID or isn't on the map, leave it as plain text.\n"
            "11. Proper Casing for Locations: All location names, whether plain text or inside markdown links (in both the `location` and `description` fields), must start with an uppercase letter. "
            "For example, use 'Stage', 'Pool', 'Basketball Court', 'Store', 'Gaga Pit', and 'Archery Range' instead of lowercase versions. "
            "When wrapping a location name in a markdown link, capitalize the display text (e.g. '[Pool](maplocation://oski/pool)' instead of '[pool](maplocation://oski/pool)').\n"
            "12. Time Range PM Resolution: When a time range is specified with a meridian marker at the end (e.g. '3:30-4:30 PM' or '1:30-4:00 PM' or '2:30-4:00 PM'), both the start and end times inherit the same marker (PM in this case) unless explicitly specified otherwise. For example, '3:30-4:30 PM' must be parsed as 15:30:00 to 16:30:00 (not 03:30:00), and '2:30-4:00 PM' must be parsed as 14:30:00 to 16:00:00 (not 02:30:00).\n"
            "13. 24-Hour Time Conversion: When converting PM times to 24-hour format, use standard mapping: 12:00 PM -> 12:00, 1:00 PM -> 13:00, 1:30 PM -> 13:30, 2:00 PM -> 14:00, 2:30 PM -> 14:30, 3:00 PM -> 15:00, 3:30 PM -> 15:30, 4:00 PM -> 16:00, 4:30 PM -> 16:30, 5:00 PM -> 17:00, 6:00 PM -> 18:00, 7:00 PM -> 19:00, 8:00 PM -> 20:00, 9:00 PM -> 21:00, 10:00 PM -> 22:00, 11:00 PM -> 23:00. DO NOT write hour values greater than 23 (e.g., never write 24:30:00; 2:30 PM is 14:30:00, and 1:30 PM is 13:30:00).\n"
            "14. Visual Grouping and Sub-categories: If a track is visually grouped or sub-categorized by a label in the first column, "
            "row header, or cell of the grid (for example, rows in 'General Daily Times' grouped by labels like 'MEALS', 'STORE', 'Burger Shack', 'MEDICAL', 'WELLNESS CENTER / MASSAGE', etc.), "
            "you must incorporate the group/category label into the event's title. Format the title as: '{Group Name}: {Event Title}', "
            "converting the group name to Title Case (e.g., 'Meals: Breakfast Buffet', 'Burger Shack: Evening Hours', 'Store: Sunday - Friday'). "
            "Do not extract the group label as a separate track name.\n"
            "15. Zero-Padding Hours: Any hour value less than 10 MUST be zero-padded with a leading zero (e.g. '01', '02', '03', ..., '09'). Never output a single-digit hour like '2:30:00' or '9:45:00'; they must be '02:30:00' and '09:45:00' respectively.\n"
            "Here is the list of known location IDs and their human-readable names:\n"
            f"{json.dumps(known_locations, indent=2)}"
        )

        response2 = client.models.generate_content(
            model=model_name,
            contents=[pdf_part, prompt2],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=BatchExtraction,
                temperature=0.1,
            ),
        )

        batch_data = BatchExtraction.model_validate_json(response2.text)
        return batch_data.results

    batch_size = 3
    track_names = [t.name for t in detected_tracks]
    batches = [track_names[i:i + batch_size] for i in range(0, len(track_names), batch_size)]
    
    extracted_events_by_track = {name: [] for name in track_names}

    if not batches:
        print("Warning: No tracks detected to extract.")
    else:
        print(f"Launching {len(batches)} concurrent extraction batches...")
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(batches)) as executor:
            futures = {executor.submit(extract_batch, b): b for b in batches}
            
            for future in concurrent.futures.as_completed(futures):
                batch = futures[future]
                try:
                    results = future.result()
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

    final_tracks = []
    # Build final list in original track order
    for track_meta in detected_tracks:
        track_name = track_meta.name
        banner = track_meta.banner
        events = extracted_events_by_track.get(track_name, [])
        
        processed_events = []
        for event in events:
            val = f"{event.title}_{event.startTime}_{track_name}"
            evt_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, val))
            
            processed_evt = {
                "id": evt_id,
                "startTime": event.startTime,
                "endTime": event.endTime,
                "title": event.title,
                "location": clean_location(event.location),
                "description": clean_description(event.description)
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
