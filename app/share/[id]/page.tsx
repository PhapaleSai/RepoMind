import SharedAnswerView from "@/components/SharedAnswerView";

export default function SharePage({ params }: { params: { id: string } }) {
  return <SharedAnswerView id={params.id} />;
}
