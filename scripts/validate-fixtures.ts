import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeJpegBytes, detectAndExtractMarker, encodeJpegBase64 } from '../src/lib/marker';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');
const fixturesRoot = path.join(projectRoot, 'fixtures', 'marker1');
const outputRoot = path.join(projectRoot, 'artifacts', 'validation');

type ValidationExpectation = {
  directory: string;
  shouldDetect: boolean;
};

const expectations: ValidationExpectation[] = [
  { directory: path.join(fixturesRoot, 'correct'), shouldDetect: true },
  { directory: path.join(fixturesRoot, 'incorrect'), shouldDetect: false },
];

async function main() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  let failures = 0;
  let checks = 0;

  for (const expectation of expectations) {
    const fileNames = (await readdir(expectation.directory)).filter((fileName) =>
      fileName.toLowerCase().endsWith('.jpg'),
    );

    for (const fileName of fileNames) {
      checks += 1;

      const inputPath = path.join(expectation.directory, fileName);
      const bytes = await readFile(inputPath);
      const image = decodeJpegBytes(bytes);
      const detection = detectAndExtractMarker(image);
      const detected = Boolean(detection);

      if (detected !== expectation.shouldDetect) {
        failures += 1;
        console.error(
          `${expectation.shouldDetect ? 'MISS' : 'FALSE POSITIVE'} ${fileName} ${detected ? 'detected' : 'not detected'}`,
        );
        continue;
      }

      const statusLabel = detected ? 'PASS' : 'REJECT';
      const confidenceLabel = detection ? ` confidence=${detection.confidence.toFixed(3)}` : '';
      console.log(`${statusLabel} ${fileName}${confidenceLabel}`);

      if (!detection) {
        continue;
      }

      const outputBase64 = encodeJpegBase64(detection.output, 92);
      await writeFile(
        path.join(outputRoot, fileName.replace(/\.jpg$/i, '-extracted.jpg')),
        Buffer.from(outputBase64, 'base64'),
      );
    }
  }

  console.log(`Validated ${checks} fixtures with ${failures} failure(s).`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
