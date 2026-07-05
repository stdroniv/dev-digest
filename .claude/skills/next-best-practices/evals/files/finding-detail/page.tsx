import type { Metadata } from 'next';
import Image from 'next/image';
import { getFinding, getFindingComments, getFindingAuthor } from './lib';
import { FindingTimeline } from './FindingTimeline';
import { FindingActions } from './FindingActions';

type Props = {
  params: Promise<{ repoId: string; findingId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { findingId } = params as unknown as { findingId: string };
  const finding = await getFinding(findingId);
  return { title: `Finding ${finding.id}`, description: finding.message };
}

export default async function FindingDetailPage({ params }: Props) {
  const { repoId, findingId } = await params;

  const finding = await getFinding(findingId);
  const comments = await getFindingComments(findingId);
  const author = await getFindingAuthor(findingId);

  const handleAcknowledge = () => {
    console.log('acknowledged', findingId);
  };

  return (
    <div>
      <h1>{finding.message}</h1>
      <p>Reported by {author.name}</p>
      <Image
        src={author.avatarUrl}
        alt={`${author.name} avatar`}
        width={48}
        height={48}
        sizes="48px"
      />
      <FindingTimeline createdAt={finding.createdAt} comments={comments} />
      <FindingActions onAcknowledge={handleAcknowledge} repoId={repoId} />
    </div>
  );
}
