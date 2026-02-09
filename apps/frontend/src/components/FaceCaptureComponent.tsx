/**
 * Face Capture Component
 * 
 * Provides a camera interface for capturing face images
 * - Video preview with canvas overlay
 * - Capture button
 * - Displays captured face preview
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  getCameraStream,
  stopCameraStream,
  captureFaceFromVideo,
  type FaceCapture,
} from '../services/faceEncodingService';

interface FaceCaptureProps {
  onCapture: (face: FaceCapture) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const FaceCaptureComponent: React.FC<FaceCaptureProps> = ({
  onCapture,
  onCancel,
  isLoading = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize camera stream on mount
  useEffect(() => {
    const initCamera = async () => {
      try {
        const mediaStream = await getCameraStream();
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          // Wait for video to load
          await new Promise((resolve) => {
            videoRef.current?.addEventListener('loadedmetadata', resolve, { once: true });
          });
        }
      } catch (err: any) {
        setError(err.message || 'Failed to access camera');
      }
    };

    initCamera();

    return () => {
      if (stream) {
        stopCameraStream(stream);
      }
    };
  }, []);

  // Capture face from video
  const handleCapture = async () => {
    if (!videoRef.current) return;

    try {
      setIsCapturing(true);
      const face = await captureFaceFromVideo(videoRef.current);

      // Convert canvas to image for preview
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d')!;
        ctx.putImageData(face.imageData, 0, 0);
        setCapturedImage(canvasRef.current.toDataURL('image/jpeg'));
      }

      // Stop stream
      if (stream) {
        stopCameraStream(stream);
        setStream(null);
      }

      // Callback with face data
      onCapture(face);
    } catch (err: any) {
      setError(err.message || 'Failed to capture face');
    } finally {
      setIsCapturing(false);
    }
  };

  // Reset to camera view
  const handleRetake = async () => {
    setCapturedImage(null);
    try {
      const mediaStream = await getCameraStream();
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      setError(err.message || 'Failed to access camera');
    }
  };

  if (error) {
    return (
      <div className="p-6 bg-red-900/30 border border-red-500 rounded-lg text-center">
        <div className="text-red-400 mb-4">⚠️ Camera Error</div>
        <p className="text-sm text-red-300 mb-4">{error}</p>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Camera/Preview Container */}
      <div className="relative w-full bg-slate-950 rounded-lg overflow-hidden border-2 border-blue-500">
        {!capturedImage ? (
          <>
            {/* Video Feed */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full aspect-video object-cover"
            />

            {/* Face Detection Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* Face Detection Frame */}
              <div className="w-48 h-64 border-4 border-green-400 rounded-lg opacity-60" />
              <div className="absolute bottom-4 left-4 text-xs text-green-400 bg-black/50 px-3 py-1 rounded">
                Position face in frame
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Captured Image Preview */}
            <img
              src={capturedImage}
              alt="Captured face"
              className="w-full aspect-video object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
              <div className="text-center">
                <div className="text-4xl mb-2">✅</div>
                <p className="text-sm text-white font-medium">Face Captured</p>
              </div>
            </div>
          </>
        )}

        {/* Hidden Canvas for Processing */}
        <canvas ref={canvasRef} className="hidden" width={640} height={480} />
      </div>

      {/* Instructions */}
      {!capturedImage && (
        <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-500 text-sm text-blue-200 space-y-2">
          <div className="font-medium">📷 Camera Instructions</div>
          <ul className="space-y-1 text-xs">
            <li>✓ Make sure you're in a well-lit area</li>
            <li>✓ Face the camera directly</li>
            <li>✓ Keep your face fully visible in the frame</li>
            <li>✓ Avoid shadows on your face</li>
          </ul>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {!capturedImage ? (
          <>
            <button
              onClick={handleCapture}
              disabled={isCapturing || isLoading || !stream}
              className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2"
            >
              {isCapturing ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Capturing...
                </>
              ) : (
                <>
                  📸 Capture
                </>
              )}
            </button>
            <button
              onClick={onCancel}
              disabled={isCapturing || isLoading}
              className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleCapture}
              disabled={isCapturing || isLoading}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2"
            >
              {isCapturing ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Verifying...
                </>
              ) : (
                <>
                  ✅ Use This Photo
                </>
              )}
            </button>
            <button
              onClick={handleRetake}
              disabled={isCapturing || isLoading}
              className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all"
            >
              🔄 Retake
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default FaceCaptureComponent;
