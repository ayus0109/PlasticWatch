# Real-World Plastic Waste Dataset Directory

Place any real-world photographs (`.jpg`, `.jpeg`, `.png`, `.webp`) in this folder.

## How PlasticWatch Uses This Folder
1. **Automatic Ingestion**: Whenever `seed_demo.py` runs or reports are simulated, the system checks this folder first.
2. **AI Detection**: Every photo placed here is run through the Ultralytics YOLO model (`backend/weights/best.pt`) to detect plastic waste:
   - `plastic_bottle`
   - `plastic_bag_film`
   - `plastic_packaging`
   - `plastic_other`
   - `non_plastic_litter`
3. **Map Display**: Your photos appear on the GIS map dashboard under **Citizen Proof & Evidence** with annotated detection boxes and severity scores.
4. **Fallback**: If this folder is empty, PlasticWatch uses the built-in curated real-world TACO photo dataset in `seed/real_photos/`.
