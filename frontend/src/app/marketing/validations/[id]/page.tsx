import ValidationResults from "@/components/marketing/ValidationResults";
export default async function MarketingValidationPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ValidationResults runId={id}/>;}
