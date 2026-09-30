# Face test fixtures

Used by `src/biometrics/biometrics.test.ts` and `src/tests/faceMatchingApi.e2e.py`.

| File | Content | Source |
|---|---|---|
| `synthetic-center.jpg` | synthetic person, facing the camera | `samples/in/ai-face.jpg` |
| `synthetic-left.jpg` | same person, head turned to their left | `samples/in/ai-upper.jpg` |
| `synthetic-right.jpg` | same person, head turned to their right | `samples/in/ai-body.jpg` |
| `synthetic-*-m.jpg` | the above, mirrored (pose flips), used as the "different photos of the same person" | derived |
| `other-a.jpg`, `other-b.jpg`, `other-a-m.jpg` | a different, real person | `samples/in/person-vlado.jpg`, `person-vlado1.jpg` |
| `no-face.jpg` | a gradient with no face | generated |
| `two-faces.jpg` | the synthetic face and `other-a` side by side | derived |

Sources are the sample images of [vladmandic/human](https://github.com/vladmandic/human)
(MIT licence, © Vladimir Mandic), published there for automated tests. The
`ai-*` images are AI-generated faces of nobody. The `person-vlado*` images are
photographs of the library's author, published by him in that repository.

Do not add photographs of real people from anywhere else.
