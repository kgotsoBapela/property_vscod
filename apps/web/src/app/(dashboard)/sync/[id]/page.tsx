import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@propintel/shared";
import { PageHeader } from "@/components/dashboard/bits";
import { JobDetail } from "@/components/sync/job-detail";
import { getRepository, requireCapabilityPage } from "@/lib/auth/session";

export const metadata = { title: "Sync job" };

export default async function JobPage(props: PageProps<"/sync/[id]">) {
  const { id } = await props.params;
  const viewer = await requireCapabilityPage("sync:read");
  const data = await getRepository().getJob(id);
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title="Sync job"
        description={
          <>
            <span className="font-mono text-xs">{id}</span>
            {data.job.target_property_id && (
              <>
                {" "}·{" "}
                <Link href={`/properties/${data.job.target_property_id}`} className="text-primary hover:underline">
                  target property
                </Link>
              </>
            )}{" "}
            · <Link href="/sync" className="text-primary hover:underline">all jobs</Link>
          </>
        }
      />
      <JobDetail initial={data} canCancel={can(viewer.role, "sync:trigger")} />
    </>
  );
}
