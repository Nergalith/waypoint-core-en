# Waypoint Core EN Demo Script

Use this script to prove the clean English test workflow without CAR demo data.

1. Start Waypoint
   - Double-click Open Waypoint Core.vbs.
   - Confirm the browser opens at http://127.0.0.1:5174.

2. Confirm clean state
   - Reports, photos, documents, field objects, and timeline should be empty.

3. Create a field report
   - Open Field Reports.
   - Enter who/what/where/when notes.
   - Leave coordinates blank for the first save.
   - Save the report.

4. Use map click for report position
   - Open Map.
   - Click Choose report position.
   - Click inside the test map boundary.
   - Confirm the Field Report form receives latitude/longitude.
   - Save or update the report.

5. Add a photo
   - Open Photos.
   - Upload a small JPEG.
   - If the photo has GPS, confirm a blue pin appears on the map.

6. Add a document
   - Open Documents.
   - Upload a small TXT or CSV containing a decimal coordinate, such as 10.0, 5.0.
   - Create a document point if a coordinate is found.

7. Create a field object
   - Open Field Objects.
   - Create one vehicle or location with optional coordinates.
   - Confirm it can be shown on the map if coordinates were added.

8. Check timeline
   - Open Timeline.
   - Confirm reports, photos, documents, and event objects appear where available.
   - Generate a simple text summary.

9. Stop Waypoint
   - Double-click Close Waypoint Core.vbs.
