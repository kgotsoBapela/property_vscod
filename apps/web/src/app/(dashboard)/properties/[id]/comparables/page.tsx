import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@propintel/shared";
import { PageHeader } from "@/components/dashboard/bits";
import { ComparablesExplorer } from "@/components/property/comparables-explorer";
import { getRepository, requireViewer } from "@/lib/auth/session";

export const metadata = { title: "Comparable sales" };

export default async function ComparablesPage(props: PageProps<"/properties/[id]/comparables">) {
  const { id } = await props.params;
  const viewer = await requireViewer();
  const d = await getRepository().getProperty(id, viewer);
  if (!d) notFound();
  return (
    <>
      <PageHeader
        title="Comparable-sale explorer"
        description={
          <>
            Registered comparable sales around{" "}
            <Link href={`/properties/${id}`} className="text-primary hover:underline">
              {d.property.normalized_address}
            </Link>
            . Non-arm&apos;s-length transfers (sales in execution, related-party, donations) are excluded by default.
          </>
        }
      />
      <ComparablesExplorer propertyId={id} subjectType={d.property.property_type} canReview={can(viewer.role, "comparable:review")} />
    </>
  );
}
