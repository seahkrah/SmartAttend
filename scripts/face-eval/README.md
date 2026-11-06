# Face-matching evaluation

How well face matching tells people apart, measured on a labelled dataset
with the engine the API uses.

```bash
cd apps/backend
npx tsx src/scripts/faceEval.ts <dataset-dir> --threshold 0.5 \
  --out ../../docs/scorecard/evidence/face-eval-report.json
node ../../scripts/face-eval/check-report.mjs
```

## The dataset

The directory holds the images and a `manifest.json`. The format is in
the header of `apps/backend/src/scripts/faceEval.ts`. The manifest gives:
- the dataset's purpose, licence, consent and provenance;
- each identity's demographic attributes;
- each image's lighting and device class.

**There is no evaluation dataset in this repository.** Owner action OA-10
asks for one, with this provenance:

- **Licensed for this use.** Biometric evaluation, by this project.
- **Consented.** The people in it agreed to their faces being used to
  evaluate a face-matching system, or the dataset's licence covers that.
- **Large enough.**
  - At least 3,000 impostor pairs, to measure a false-accept rate of 0.1%.
  - At least 300 genuine pairs, to measure a false-reject rate of 5%.
  - Several images per person, in the lighting and on the devices the
    schools and employers will use.
- **Varied enough to say something about demographic parity:** age bands,
  sexes and skin tones, recorded per identity.

Do not use photographs of real people from anywhere else, and do not commit
the images.

## The gate

`check-report.mjs` fails until the committed report shows all of the
following:
- an evaluation set, not a smoke run;
- a dataset with its licence, consent and provenance stated;
- enough pairs to measure both rates;
- a demographic breakdown;
- FAR at or below 0.1% and FRR at or below 5% at the default threshold 0.5,
  where a face never found counts as a rejection.

## A smoke run

The test fixtures (`apps/backend/src/tests/fixtures/faces`) are a handful of
images of two people. They show the harness runs, and nothing about
accuracy. A manifest for them must say `"purpose": "smoke"`, and the gate
never accepts one.
