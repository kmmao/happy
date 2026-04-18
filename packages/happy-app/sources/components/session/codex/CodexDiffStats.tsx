import * as React from "react";

import { DiffStatsBar } from "@/components/diff/DiffStatsBar";

interface CodexDiffStatsProps {
  additions: number;
  deletions: number;
}

export const CodexDiffStats = React.memo<CodexDiffStatsProps>(
  function CodexDiffStats({ additions, deletions }) {
    return (
      <DiffStatsBar
        additions={additions}
        deletions={deletions}
        provider="codex"
      />
    );
  },
);
