import mongoose, { Schema } from 'mongoose';

const MediaSchema = new Schema(
  {
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'deleted'],
      default: 'pending',
    },
  },
  { strict: true, timestamps: true },
);

export const Media = mongoose.model('Media', MediaSchema);
