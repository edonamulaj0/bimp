# ml/ · fixture detector

Counts of windows, doors, toilets, sinks and showers/bathtubs are ~85% of the challenge's questions (CubiCasa5K plans).
`train_fixtures.ipynb` trains a YOLO detector for them on Colab (free T4) from the original CubiCasa5K annotations and
scores it on the challenge questions, fairly: train split for training, val for thresholds, test for the score.

- `cc_labels.py` · CubiCasa `model.svg` → object boxes (nested transforms, furniture inside cabinets)
- `classes.py` · which annotation classes count as what; checked against the challenge answers (546/546 on a sample)
- `prepare.py` · CubiCasa5K → YOLO dataset (images `F1_scaled.png`, where the SVG coordinates live)
- `evaluate.py` · per-class threshold tuned on val, exact-count accuracy on test

Open in Colab: upload `train_fixtures.ipynb` (File → Upload notebook). Output: `models/fixtures-v1.onnx` and its report
in R2 (or Google Drive). CubiCasa5K is CC BY-NC-SA 4.0, so the model is for non-commercial use.
