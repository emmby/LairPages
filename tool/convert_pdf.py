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
    name: str = Field(description="The exact name of the track/category (e.g. 'All-camp Activities', 'Burger Shack', 'Pool', 'Meals', 'Store', 'Wellness/Massage', 'Medical', 'Athletics', 'Archery', 'Nature/Hiking', 'Arts and Crafts', 'Music', 'Cub Corral', 'Lair Yoga', 'Teddy Bears', 'Golden Bears', 'Cal Bears', 'Grizzly Bears').")
    banner: Optional[str] = Field(None, description="Any general policies, rules, warnings, or announcements listed under this track header (e.g. Pool adult swim rule, arts & crafts rules). Null if none.")
    estimated_events: Optional[int] = Field(None, description="Rough estimate of the total number of events or rows listed in this track in the PDF. Count multi-day repeat events as separate rows.")

class ScheduleMetadata(BaseModel):
    year: int = Field(description="The year of the schedule (e.g. 2026)")
    camp: str = Field(description="The camp ID (blue, gold, oski) parsed from the document")
    week: int = Field(description="The week number parsed from the document")
    start_date: str = Field(description="The date of the Saturday check-in, formatted as YYYY-MM-DD (e.g. '2026-06-20')")
    tracks: List[TrackMetaModel] = Field(description="List of all tracks/categories that contain events or rules in the document")

class EventModel(BaseModel):
    startTime: str = Field(description="ISO 8601 datetime format (e.g. '2026-06-20T15:00:00-07:00' with PDT -07:00 offset). Mapped to the actual calendar day of the week based on Saturday check-in.")
    endTime: Optional[str] = Field(None, description="ISO 8601 datetime format with PDT -07:00 offset, or null if no end time is specified.")
    title: str = Field(description="The title of the event.")
    location: Optional[str] = Field(None, description="The location of the event, or null if not specified.")
    description: Optional[str] = Field(None, description="Detailed description of the event. Preserve markdown formatting like bold text, lists, or italics.")

class TrackEvents(BaseModel):
    track_name: str = Field(description="The exact name of the track.")
    events: List[EventModel] = Field(description="List of events belonging to this track.")

class BatchExtraction(BaseModel):
    results: List[TrackEvents] = Field(description="List of extractions for each queried track.")

# ==========================================
# Core Conversion Flow
# ==========================================

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
        print("Error: GEMINI_API_KEY environment variable is not set.")
        sys.exit(1)

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
        "Also, identify all active tracks/categories (e.g. 'All-camp Activities', 'Meals', 'Pool', 'Arts and Crafts', 'Teddy Bears', etc.) "
        "that have scheduled events or warnings, along with any track-level banner/policy announcements.\n"
        "For each detected track, estimate the total number of events (rows) listed under it in the PDF schedule grid. "
        "For recurring multi-day events or items listed with multiple times, count each daily occurrence as a separate event.\n\n"
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
    print("  - Detected Tracks & Estimates:")
    for t in detected_tracks:
        print(f"    * {t.name}: ~{t.estimated_events or 0} events")

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
            f"'{start_date}' (PDT timezone offset -07:00, e.g., '2026-06-20T15:00:00-07:00').\n"
            "4. Expand recurring events (e.g. daily store hours or daily meals) into individual daily entries.\n"
            "5. Split events with multiple daily times (e.g. '9:00 AM & 2:00 PM') into separate events.\n"
            "6. Omit non-event text blocks like Land Acknowledgements.\n"
            "7. Preserve markdown formatting like bold text or list items in event descriptions.\n"
            "8. Markdown Escaping: If the source PDF contains literal characters like asterisks (e.g. '*' or '**'), underscores ('_'), "
            "or backticks ('`') that are part of the literal text and not meant as markdown styling, you must escape them (e.g. '\\*', '\\*\\*', '\\_', '\\`') "
            "so they are not interpreted as markdown formatting by the app's renderer.\n"
            f"9. The 'track_name' field for each entry in 'results' must exactly match one of: {track_names_str}."
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

    # Greedy load-balancing partitioner using estimated event counts
    num_batches = 6
    track_names = [t.name for t in detected_tracks]
    
    if not track_names:
        batches = []
    else:
        # Sort tracks by estimated count descending
        sorted_tracks = sorted(detected_tracks, key=lambda x: x.estimated_events or 0, reverse=True)
        batches = [[] for _ in range(min(num_batches, len(track_names)))]
        batch_totals = [0] * len(batches)
        
        for track in sorted_tracks:
            # Find the batch with the smallest current event total
            min_idx = batch_totals.index(min(batch_totals))
            batches[min_idx].append(track.name)
            batch_totals[min_idx] += (track.estimated_events or 0)
            
        print("\nBalanced Batches Config:")
        for idx, (b, total) in enumerate(zip(batches, batch_totals)):
            print(f"  * Batch {idx+1}: {b} (Estimated events total: {total})")
    
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
                "location": event.location,
                "description": event.description
            }
            processed_events.append(processed_evt)

        # Sort events chronologically by startTime, then by title
        processed_events.sort(key=lambda x: (x.get("startTime", ""), x.get("title", "")))

        final_tracks.append({
            "name": track_name,
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
