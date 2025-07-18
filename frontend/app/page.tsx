"use client"
import React, { useState, useRef } from "react";
import { Video } from "lucide-react";

export default function Page() {
  const [isFileSelected, setIsFileSelected] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
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
      const formData = new FormData();
      formData.append("video", selectedFile!);
      
      fetch(`${BACKEND_URL}/api/editor/upload`, {
        method: "POST",
        body: formData,
      })
        .then((response) => response.json())
        .then((data) => {
          setIsFileSelected(false);
          setSelectedFile(null);
        })
        .catch((error) => {
          console.error("Error uploading file:", error);
          alert("Failed to upload file.");
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
          <div className="flex items-center border border-[#181818] rounded-full px-6 py-2 gap-2">
            <Video size={20} className="text-[#f0f0f0]" />
            <span title={selectedFile?.name}>{selectedFile?.name}</span>
          </div>
        )}
        {isFileSelected && (
          <button
            className="border border-[#181818] rounded-full px-6 py-2 hover:bg-[#181818] transition-all cursor-pointer"
            onClick={handleUpload}
          >
            Upload
          </button>
        )}
      </div>
     
    </div>
  );
}
