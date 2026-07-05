import argparse
import json
import os
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from typing import List, Optional

# Simple model for event extraction testing
class RawEventModel(BaseModel):
    raw_day: str = Field(description="Day of the week (e.g. Monday)")
    raw_time: str = Field(description="Raw time text (e.g. 9:00-10:00 AM)")
    title: str = Field(description="Title of the event")
    location: Optional[str] = Field(None, description="Location of the event")
    description: Optional[str] = Field(None, description="Description of the event")

class RawTrackEvents(BaseModel):
    track_name: str = Field(description="Name of the schedule track")
    events: List[RawEventModel] = Field(default_factory=list, description="Events in this track")

class RawBatchExtraction(BaseModel):
    results: List[RawTrackEvents] = Field(default_factory=list)

def test_extraction(pdf_path: str, tracks: List[str]):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        if os.path.exists(".tmp/api_key.txt"):
            with open(".tmp/api_key.txt", "r") as f:
                api_key = f.read().strip()
        elif os.path.exists(".env"):
            import re
            with open(".env", "r") as f:
                for line in f:
                    match = re.match(r'^\s*GEMINI_API_KEY\s*=\s*["\']?([^#"\']*)["\']?', line)
                    if match:
                        api_key = match.group(1).strip()
                        break
    
    if not api_key:
        print("Error: GEMINI_API_KEY environment variable not set, and no key found in .tmp/api_key.txt or .env")
        return

    print(f"Reading PDF: {pdf_path}")
    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()

    client = genai.Client(api_key=api_key)
    tracks_str = ", ".join(f"'{t}'" for t in tracks)
    
    prompt = (
        "You are an expert schedule extraction assistant.\n"
        f"Extract all events belonging to the following tracks: [{tracks_str}] from the provided PDF schedule.\n\n"
        "Rules:\n"
        "1. Extract raw day and time values exactly as shown.\n"
        "2. Preserve the entire event description.\n"
        "3. Time-Only Extraction: Only extract items with explicit scheduled times."
    )

    print(f"Calling gemini-3.5-flash to extract tracks: {tracks}...")
    response = client.models.generate_content(
        model="gemini-3.5-flash",
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            prompt
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=RawBatchExtraction,
            temperature=0.1,
            max_output_tokens=8192,
            thinking_config=types.ThinkingConfig(
                thinking_budget=1024
            )
        )
    )

    print(f"Candidate Finish Reason: {response.candidates[0].finish_reason if response.candidates else 'None'}")
    print(f"Usage metadata: {response.usage_metadata}")
    print("\n--- EXTRACTED JSON ---")
    print(response.text)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Gemini schedule extraction on specific tracks.")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("tracks", nargs="+", help="One or more track names to extract")
    args = parser.parse_args()
    test_extraction(args.pdf_path, args.tracks)
