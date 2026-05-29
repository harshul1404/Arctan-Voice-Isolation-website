import { Dashboard } from "@/components/Dashboard";

export default function Page() {
  const maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? "100");
  return <Dashboard maxUploadMb={Number.isFinite(maxUploadMb) ? maxUploadMb : 100} />;
}
