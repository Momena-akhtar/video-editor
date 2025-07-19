"use client"
import React, { useState, useRef } from "react";
import { Video } from "lucide-react";

export default function Page() {
  const [isFileSelected, setIsFileSelected] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

  const handleDownload = async () => {
    if (downloadUrl) {
      try {
        console.log('Downloading from:', downloadUrl);
        const response = await fetch(downloadUrl);
        
        // Check if response is ok
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Download failed:', response.status, errorText);
          setProcessingError(`Download failed: ${response.status} - ${errorText}`);
          return;
        }
        
        // Check content type to ensure it's a video
        const contentType = response.headers.get('content-type');
        console.log('Content-Type:', contentType);
        
        if (!contentType || !contentType.includes('video/')) {
          console.error('Invalid content type:', contentType);
          setProcessingError('Download failed: Invalid file type received');
          return;
        }
        
        const blob = await response.blob();
        console.log('Downloaded blob size:', blob.size, 'bytes');
        
        // Check if blob size is reasonable (more than 1KB)
        if (blob.size < 1024) {
          console.error('File too small:', blob.size, 'bytes');
          setProcessingError('Download failed: File appears to be corrupted or empty');
          return;
        }
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'video-with-subtitles.mp4';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        console.log('Download completed successfully');
      } catch (error) {
        console.error('Download failed:', error);
        setProcessingError('Download failed');
      }
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleClearSelection = () => {
    setIsFileSelected(false);
    setSelectedFile(null);
    setDownloadUrl(null);
    setProcessingError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type === "video/mp4") {
        setIsFileSelected(true);
        setSelectedFile(file);
      } else {
        alert("Please select an MP4 file.");
        setIsFileSelected(false);
        setSelectedFile(null);
      }
    }
  };
  const handleUpload = () => {
    if (isFileSelected) {
      setIsProcessing(true);
      setDownloadUrl(null);
      setProcessingError(null);
      
      const formData = new FormData();
      formData.append("video", selectedFile!);
      
      fetch(`${BACKEND_URL}/api/editor/process-video`, {
        method: "POST",
        body: formData,
      })
        .then((response) => response.json())
        .then((data) => {
          console.log("Processing result:", data);
          if (data.success) {
            setDownloadUrl(`${BACKEND_URL}${data.downloadUrl}`);
          } else {
            setProcessingError(data.error || "Processing failed");
          }
          setIsProcessing(false);
          // Don't clear file selection on success - let user process another video
        })
        .catch((error) => {
          console.error("Error processing file:", error);
          setProcessingError("Failed to process file");
          setIsProcessing(false);
        });
    }
  }

  return (
    <div className="font-sans flex flex-col items-center justify-items-center min-h-screen p-8 pb-20 gap-6 sm:p-20">
      <h1 className="text-4xl font-bold text-center sm:text-left">
        Video Editor
      </h1>
      <p>Drop your files here.</p>
      <input
        type="file"
        accept="video/mp4"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <div className="flex gap-4 items-center">
        {!isFileSelected ? (
          <button
            className="border border-[#181818] rounded-full px-6 py-2 hover:bg-[#181818] transition-all cursor-pointer"
            onClick={handleBrowseClick}
          >
            Browse
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-[#181818] rounded-full px-6 py-2 gap-2">
              <Video size={20} className="text-[#f0f0f0]" />
              <span title={selectedFile?.name}>{selectedFile?.name}</span>
            </div>
            <button
              className="border border-[#181818] rounded-full px-6 py-2 hover:bg-[#181818] transition-all cursor-pointer"
              onClick={handleClearSelection}
            >
              Clear
            </button>
          </div>
        )}
        {isFileSelected && (
          <button
            className="border border-[#181818] rounded-full px-6 py-2 bg-[#181818] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleUpload}
            disabled={isProcessing}
          >
            {isProcessing ? "Processing..." : "Upload"}
          </button>
        )}
      </div>
      
      {/* Processing Status */}
      {isProcessing && (
        <div className="text-center">
          <p className="text-blue-500">Processing your video with subtitles...</p>
          <p className="text-sm text-gray-500">This may take a few minutes</p>
        </div>
      )}
      
      {/* Download Button */}
      {downloadUrl && (
        <div className="text-center">
          <p className="text-green-500 mb-2">Video processed successfully!</p>
          <button
            onClick={handleDownload}
            className="inline-block bg-green-500 text-white px-6 py-2 rounded-full hover:bg-green-600 transition-all cursor-pointer"
          >
            Download Video with Subtitles
          </button>
        </div>
      )}
      
      {/* Error Message */}
      {processingError && (
        <div className="text-center">
          <p className="text-red-500">❌ {processingError}</p>
        </div>
      )}
    </div>
  );
}
