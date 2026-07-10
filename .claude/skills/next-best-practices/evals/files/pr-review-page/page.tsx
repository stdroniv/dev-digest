import { useSearchParams } from 'next/navigation';
import { RepoTokenBadge } from './RepoTokenBadge';

type Props = {
  params: { repoId: string };
};

export default function RepoInsightsPage({ params }: Props) {
  const filter = useSearchParams().get('filter') ?? 'all';
  const repoId = params.repoId;

  return (
    <div>
      <h1>Insights for {repoId}</h1>
      <p>Filter: {filter}</p>
      <RepoTokenBadge />
    </div>
  );
}
