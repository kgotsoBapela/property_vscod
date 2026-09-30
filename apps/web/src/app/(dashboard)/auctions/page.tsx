import Link from "next/link";
import { Alert, Card, CardContent } from "@/components/ui/primitives";
import { PageHeader } from "@/components/dashboard/bits";
import { AuctionTable } from "@/components/auction/auction-table";
import { getRepository, requireViewer } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const metadata = { title: "Auctions" };

export default async function AuctionsPage(props: PageProps<"/auctions">) {
  await requireViewer();
  const sp = await props.searchParams;
  const scope = sp.scope === "all" ? "all" : "upcoming";
  const items = await getRepository().listAuctions({ scope });
  const tab = (value: string, label: string) => (
    <Link
      href={`/auctions?scope=${value}`}
      className={cn("rounded-md px-3 py-1.5 text-sm", scope === value ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted")}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Auction intelligence"
        description="Sheriff sales and private auctions. Guide, reserve, opening bid and hammer price are different things and are shown separately."
      />
      <Alert tone="warning" className="mb-4">
        Auction dates and statuses change at short notice. Postponed and cancelled events are marked; always confirm with the sheriff or
        auctioneer and read the original notice and conditions of sale.
      </Alert>
      <div className="mb-3 flex gap-1">
        {tab("upcoming", "Upcoming")}
        {tab("all", "All on record")}
      </div>
      <Card>
        <CardContent className="pt-4">
          <AuctionTable items={items} />
        </CardContent>
      </Card>
    </>
  );
}
