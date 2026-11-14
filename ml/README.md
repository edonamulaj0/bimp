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

## fixtures-v1 (trained 2026-11-14)

YOLO11s at 1024 px, best epoch 58 of a 66-epoch run. Exported to `ingest/models/fixtures-v1.onnx`; thresholds and
scores are in `ingest/models/fixtures-v1.report.json`. Exact-count accuracy on CubiCasa5K test plans present in the
challenge set (387 plans, thresholds tuned on val), measured through `ingest/service.py`'s own ONNX path:

| class | exact | within ±1 |
|---|---|---|
| toilet | 90% | 99% |
| sink | 85% | 96% |
| shower_bath | 74% | 96% |
| door | 63% | 91% |
| window | 48% | 75% |
| all five | 72% | |

Running at 1536 px did not help (72.5%). Windows and doors need a change to training, not more epochs.

## In the app

`ingest/service.py` runs the detector on scans and images (`detections` in `/analyze`). `buildPlan` stores them as
`plan.detected`, and the chat's `count` tool answers door, window, wc, sink and shower_bath counts from the detector
when a plan has them; vector PDFs and DXF are unaffected. The language model still reads rooms, labels and everything
else. To replace the model: export to ONNX at 1024 px, update `DET_THRESHOLD` in `service.py`, redeploy the container.
