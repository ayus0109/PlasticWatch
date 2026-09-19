import { Shell } from "../components/Shell";
import { Card, EmptyState } from "../components/ui";

/** Placeholder — replaced in a later stage. */
export default function Queue() {
  return (
    <Shell>
      <Card>
        <EmptyState title="Coming soon">This page arrives in a later build stage.</EmptyState>
      </Card>
    </Shell>
  );
}
