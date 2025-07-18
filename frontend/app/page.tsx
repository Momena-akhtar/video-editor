"use client"
import React, { useRef } from "react";

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type === "video/mp4") {
        console.log("Selected MP4 file:", file);
      } else {
        alert("Please select an MP4 file.");
      }
    }
  };

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
      <button
        className="border border-[#181818] rounded-full px-6 py-2 hover:bg-[#181818] transition-all cursor-pointer"
        onClick={handleBrowseClick}
      >
        Browse
      </button>
    </div>
  );
}
