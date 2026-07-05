import mongoose, { Schema } from 'mongoose';

const CommentSchema = new Schema(
  {
    prId: { type: String, required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 4000 },
    isApproved: { type: Boolean, default: false },
  },
  { strict: true, timestamps: true },
);

export const Comment = mongoose.model('Comment', CommentSchema);
