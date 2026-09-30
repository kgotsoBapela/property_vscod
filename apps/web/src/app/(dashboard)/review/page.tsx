import { EmptyState, PageHeader } from "@/components/dashboard/bits";
import { ReviewItem } from "@/components/review/review-item";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";

export const metadata = { title: "Identity review" };

export default async function ReviewPage() {
  await requireCapabilityPage("identity:review");
  const items = await getRepository().listReviewQueue();
  return (
    <>
      <PageHeader
        title="Identity review queue"
        description="Records whose legal identity could not be resolved automatically. Nothing here has been merged. Decide using legal identifiers (erf, portion, scheme and unit), not the street address alone. Every decision is audited."
      />
      {items.length === 0 ? (
        <EmptyState title="Nothing awaiting review" />
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((i) => (
            <ReviewItem key={`${i.kind}:${i.id}`} item={i} />
          ))}
        </div>
      )}
    </>
  );
}
