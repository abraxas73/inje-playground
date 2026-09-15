import EmailChecks from "@/components/marketing/EmailChecks";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <EmailChecks runId={(await params).id}/>; }
