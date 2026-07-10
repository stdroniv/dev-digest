'use client';

type Comment = { id: string; body: string };

type Props = {
  createdAt: Date;
  comments: Comment[];
};

export function FindingTimeline({ createdAt, comments }: Props) {
  return (
    <div>
      <p>Opened {createdAt.getFullYear()}</p>
      <ul>
        {comments.map((c) => (
          <li key={c.id}>{c.body}</li>
        ))}
      </ul>
    </div>
  );
}
