import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraCapturedPicture, CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';

import { decodeJpegBase64, detectAndExtractMarker, encodeJpegBase64 } from './src/lib/marker';

type ScanResult = {
  id: string;
  uri: string;
  confidence: number;
  durationMs: number;
};

const TARGET_RESULTS = 20;
const OUTPUT_DIRECTORY = `${FileSystem.cacheDirectory ?? ''}marker-results/`;

function parsePictureSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/i);

  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  return {
    label: size,
    width,
    height,
  };
}

function choosePictureSize(sizes: string[]): string | null {
  const parsedSizes = sizes
    .map(parsePictureSize)
    .filter((value): value is NonNullable<typeof value> => value !== null);

  if (parsedSizes.length === 0) {
    return null;
  }

  const preferred = parsedSizes.filter(
    (size) =>
      size.width >= 2000 &&
      size.width <= 3000 &&
      size.height >= 2000 &&
      size.height <= 3000,
  );
  const candidates = preferred.length > 0 ? preferred : parsedSizes;

  return candidates
    .slice()
    .sort((left, right) => {
      const leftScore =
        Math.abs(left.width - left.height) * 2 +
        Math.abs(Math.min(left.width, left.height) - 2400);
      const rightScore =
        Math.abs(right.width - right.height) * 2 +
        Math.abs(Math.min(right.width, right.height) - 2400);

      return leftScore - rightScore;
    })[0].label;
}

async function ensureOutputDirectory() {
  if (!FileSystem.cacheDirectory) {
    throw new Error('No cache directory is available for scan output.');
  }

  await FileSystem.deleteAsync(OUTPUT_DIRECTORY, { idempotent: true });
  await FileSystem.makeDirectoryAsync(OUTPUT_DIRECTORY, { intermediates: true });
}

async function extractMarkerFromPicture(
  picture: CameraCapturedPicture,
  sequenceNumber: number,
): Promise<ScanResult | null> {
  const startedAt = Date.now();
  const base64 = await FileSystem.readAsStringAsync(picture.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const detection = detectAndExtractMarker(decodeJpegBase64(base64));

  if (!detection) {
    return null;
  }

  const outputBase64 = encodeJpegBase64(detection.output, 92);
  const outputUri = `${OUTPUT_DIRECTORY}marker-${String(sequenceNumber).padStart(2, '0')}.jpg`;

  await FileSystem.writeAsStringAsync(outputUri, outputBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    id: `${Date.now()}-${sequenceNumber}`,
    uri: outputUri,
    confidence: detection.confidence,
    durationMs: Date.now() - startedAt,
  };
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricPill}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ScanButton({
  active,
  disabled,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.scanButton,
        active ? styles.scanButtonActive : null,
        disabled ? styles.scanButtonDisabled : null,
        pressed && !disabled ? styles.scanButtonPressed : null,
      ]}>
      <Text style={styles.scanButtonLabel}>{active ? 'Stop Scan' : 'Capture 20 Markers'}</Text>
      <Text style={styles.scanButtonHint}>
        {active ? 'Finishes the current frame, then stops.' : 'Runs the detector until 20 good crops are stored.'}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const cameraReference = useRef<CameraView | null>(null);
  const stopRequested = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState('Request camera access to begin.');
  const [selectedPictureSize, setSelectedPictureSize] = useState<string | null>(null);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [lastDurationMs, setLastDurationMs] = useState(0);
  const [lastConfidence, setLastConfidence] = useState(0);

  useEffect(() => {
    if (permission?.granted) {
      setStatus('Camera ready. Point the frame at Marker1 and start scanning.');
    }
  }, [permission?.granted]);

  async function handleCameraReady() {
    setCameraReady(true);

    try {
      const sizes = await cameraReference.current?.getAvailablePictureSizesAsync();
      if (sizes && sizes.length > 0) {
        setSelectedPictureSize(choosePictureSize(sizes));
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Camera is ready, but picture size detection failed: ${error.message}`
          : 'Camera is ready, but picture size detection failed.',
      );
    }
  }

  async function handleScanPress() {
    if (isScanning) {
      stopRequested.current = true;
      setStatus('Stopping after the current frame finishes.');
      return;
    }

    if (!cameraReference.current || !cameraReady) {
      setStatus('The camera is still warming up.');
      return;
    }

    stopRequested.current = false;
    setIsScanning(true);
    setResults([]);
    setAttempts(0);
    setAccepted(0);
    setRejected(0);
    setLastDurationMs(0);
    setLastConfidence(0);
    setStatus('Scanning for Marker1...');

    let nextAttempts = 0;
    let nextAccepted = 0;
    let nextRejected = 0;

    try {
      await ensureOutputDirectory();

      while (!stopRequested.current && nextAccepted < TARGET_RESULTS) {
        const frameStartedAt = Date.now();
        const picture = await cameraReference.current.takePictureAsync({
          quality: 1,
          shutterSound: false,
          skipProcessing: false,
        });

        nextAttempts += 1;
        setAttempts(nextAttempts);

        const result = await extractMarkerFromPicture(picture, nextAccepted + 1);
        const frameDuration = Date.now() - frameStartedAt;
        setLastDurationMs(frameDuration);

        if (!result) {
          nextRejected += 1;
          setRejected(nextRejected);
          setStatus(`Frame ${nextAttempts} rejected. Looking for a stronger Marker1 candidate...`);
          continue;
        }

        nextAccepted += 1;
        setAccepted(nextAccepted);
        setLastConfidence(result.confidence);
        setResults((currentResults) => [...currentResults, result]);
        setStatus(
          `Stored marker ${nextAccepted} of ${TARGET_RESULTS} with confidence ${Math.round(
            result.confidence * 100,
          )}%.`,
        );
      }

      if (nextAccepted >= TARGET_RESULTS) {
        setStatus('Finished. All 20 corrected marker crops are ready below.');
      } else if (stopRequested.current) {
        setStatus(`Stopped with ${nextAccepted} accepted markers saved.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Scanning stopped because of an unexpected error.');
    } finally {
      setIsScanning(false);
      stopRequested.current = false;
    }
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredState}>
          <ActivityIndicator color="#1e293b" />
          <Text style={styles.stateTitle}>Checking camera permission…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centeredState}>
          <Text style={styles.eyebrow}>Alemeno Marker Assignment</Text>
          <Text style={styles.stateTitle}>Camera access is required to scan the custom marker.</Text>
          <Text style={styles.stateBody}>
            The app captures frames, verifies the `Marker1` border geometry, corrects orientation, and stores `300x300` crops.
          </Text>
          <Pressable
            onPress={requestPermission}
            style={({ pressed }) => [styles.permissionButton, pressed ? styles.scanButtonPressed : null]}>
            <Text style={styles.permissionButtonLabel}>Grant Camera Access</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerCard}>
          <Text style={styles.eyebrow}>Alemeno Marker Assignment</Text>
          <Text style={styles.title}>Marker1 Capture and Extraction</Text>
          <Text style={styles.subtitle}>
            Live React Native camera preview, orientation-aware marker extraction, and a `20`-result gallery.
          </Text>
        </View>

        <View style={styles.cameraCard}>
          <View style={styles.cameraHeader}>
            <View>
              <Text style={styles.sectionTitle}>Live Preview</Text>
              <Text style={styles.sectionCaption}>
                Hold the printed marker inside the square and keep the phone nearly parallel to the page.
              </Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeLabel}>{selectedPictureSize ?? 'Sizing…'}</Text>
            </View>
          </View>

          <View style={styles.cameraFrame}>
            <CameraView
              ref={cameraReference}
              facing="back"
              mode="picture"
              onCameraReady={handleCameraReady}
              pictureSize={selectedPictureSize ?? undefined}
              style={styles.camera}
            />
            <View pointerEvents="none" style={styles.cameraOverlay}>
              <View style={[styles.overlayCorner, styles.overlayTopLeft]} />
              <View style={[styles.overlayCorner, styles.overlayTopRight]} />
              <View style={[styles.overlayCorner, styles.overlayBottomLeft]} />
              <View style={[styles.overlayCorner, styles.overlayBottomRight]} />
            </View>
          </View>

          <Text style={styles.statusText}>{status}</Text>

          <View style={styles.metricsRow}>
            <MetricPill label="Attempts" value={String(attempts)} />
            <MetricPill label="Accepted" value={`${accepted}/${TARGET_RESULTS}`} />
            <MetricPill label="Rejected" value={String(rejected)} />
            <MetricPill label="Last Frame" value={lastDurationMs > 0 ? `${lastDurationMs} ms` : '—'} />
          </View>

          <View style={styles.metricsRow}>
            <MetricPill label="Confidence" value={lastConfidence > 0 ? `${Math.round(lastConfidence * 100)}%` : '—'} />
            <MetricPill label="Camera" value={cameraReady ? 'Ready' : 'Loading'} />
            <MetricPill label="Target" value="300x300" />
            <MetricPill label="Marker" value="Marker1" />
          </View>

          <ScanButton active={isScanning} disabled={!cameraReady} onPress={handleScanPress} />
        </View>

        <View style={styles.resultsCard}>
          <View style={styles.resultsHeader}>
            <View>
              <Text style={styles.resultsTitle}>Accepted Markers</Text>
              <Text style={styles.resultsCaption}>
                Each accepted output is the corrected `300x300` marker crop saved to local cache.
              </Text>
            </View>
            <Text style={styles.resultCount}>
              {results.length}/{TARGET_RESULTS}
            </Text>
          </View>

          {results.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>No accepted markers yet.</Text>
              <Text style={styles.emptyStateBody}>
                Start scanning to populate the gallery with corrected outputs from unique frames.
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultStrip}>
              {results.map((result, index) => (
                <View key={result.id} style={styles.resultCard}>
                  <Image source={{ uri: result.uri }} style={styles.resultImage} />
                  <Text style={styles.resultTitle}>Marker {index + 1}</Text>
                  <Text style={styles.resultMeta}>Confidence {Math.round(result.confidence * 100)}%</Text>
                  <Text style={styles.resultMeta}>{result.durationMs} ms</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f6efe4',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 18,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  headerCard: {
    backgroundColor: '#fff9f0',
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: '#ead9bf',
    gap: 8,
  },
  eyebrow: {
    color: '#9a3412',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#1f2937',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  subtitle: {
    color: '#4b5563',
    fontSize: 15,
    lineHeight: 22,
  },
  cameraCard: {
    backgroundColor: '#1e293b',
    borderRadius: 28,
    padding: 18,
    gap: 16,
  },
  cameraHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: '#fef7ed',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionCaption: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    maxWidth: 230,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fb923c',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusBadgeLabel: {
    color: '#1f2937',
    fontSize: 12,
    fontWeight: '800',
  },
  cameraFrame: {
    aspectRatio: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayCorner: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderColor: '#fdba74',
  },
  overlayTopLeft: {
    top: 18,
    left: 18,
    borderLeftWidth: 4,
    borderTopWidth: 4,
  },
  overlayTopRight: {
    top: 18,
    right: 18,
    borderRightWidth: 4,
    borderTopWidth: 4,
  },
  overlayBottomLeft: {
    bottom: 18,
    left: 18,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
  },
  overlayBottomRight: {
    bottom: 18,
    right: 18,
    borderRightWidth: 4,
    borderBottomWidth: 4,
  },
  statusText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricPill: {
    minWidth: '47%',
    flexGrow: 1,
    backgroundColor: '#334155',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  scanButton: {
    backgroundColor: '#f97316',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 4,
  },
  scanButtonActive: {
    backgroundColor: '#dc2626',
  },
  scanButtonDisabled: {
    backgroundColor: '#64748b',
  },
  scanButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  scanButtonLabel: {
    color: '#fff7ed',
    fontSize: 17,
    fontWeight: '800',
  },
  scanButtonHint: {
    color: '#ffedd5',
    fontSize: 13,
    lineHeight: 18,
  },
  permissionButton: {
    backgroundColor: '#ea580c',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  permissionButtonLabel: {
    color: '#fff7ed',
    fontSize: 15,
    fontWeight: '800',
  },
  stateTitle: {
    color: '#1f2937',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 30,
  },
  stateBody: {
    color: '#4b5563',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  resultsCard: {
    backgroundColor: '#fffaf2',
    borderRadius: 28,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: '#ead9bf',
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  resultsTitle: {
    color: '#1f2937',
    fontSize: 20,
    fontWeight: '800',
  },
  resultsCaption: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    maxWidth: 230,
  },
  resultCount: {
    color: '#9a3412',
    fontSize: 22,
    fontWeight: '800',
  },
  emptyState: {
    paddingVertical: 24,
    gap: 6,
  },
  emptyStateTitle: {
    color: '#1f2937',
    fontSize: 17,
    fontWeight: '800',
  },
  emptyStateBody: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 20,
  },
  resultStrip: {
    gap: 12,
    paddingRight: 4,
  },
  resultCard: {
    width: 168,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f1e0c2',
    gap: 8,
  },
  resultImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
  },
  resultTitle: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '800',
  },
  resultMeta: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
});
