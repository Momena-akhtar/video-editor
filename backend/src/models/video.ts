import mongoose, { Schema, Document, Model } from 'mongoose';

export interface VideoDocument extends Document {
  title: string;
  filePath: string;
  callbackUrl?: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  outputUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const VideoSchema = new Schema<VideoDocument>(
  {
    title: { type: String, required: true, trim: true },
    filePath: { type: String, required: true },
    callbackUrl: { type: String },
    status: {
      type: String,
      enum: ['uploaded', 'processing', 'ready', 'failed'],
      default: 'uploaded',
      index: true,
    },
    outputUrl: { type: String },
  },
  { timestamps: true }
);

VideoSchema.index({ createdAt: -1 });

export const Video: Model<VideoDocument> =
  mongoose.models.Video || mongoose.model<VideoDocument>('Video', VideoSchema);


