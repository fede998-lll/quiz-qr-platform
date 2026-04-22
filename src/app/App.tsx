import { useMemo } from "react";
import type { AppGateway } from "../types/gateway";
import { getAppEnv } from "../lib/env";
import { parseUrlState } from "../lib/url";
import { createSupabaseGateway } from "../lib/supabase/gateway";
import { HostApp } from "../features/host/HostApp";
import { StudentApp } from "../features/student/StudentApp";
import "../app/styles.css";

export function createGateway(): AppGateway {
  return createSupabaseGateway();
}

interface AppProps {
  gateway?: AppGateway;
}

export function App(props: AppProps) {
  const urlState = parseUrlState(window.location.search);
  const env = getAppEnv();
  const hasSupabaseEnv = Boolean(env.supabaseUrl && env.supabaseAnonKey);
  const gateway = useMemo(
    () => props.gateway ?? (hasSupabaseEnv ? createGateway() : null),
    [props.gateway, hasSupabaseEnv],
  );

  if (!gateway) {
    return <MissingConfiguration />;
  }

  if (urlState.mode === "student") {
    return <StudentApp gateway={gateway} />;
  }
  return <HostApp gateway={gateway} />;
}

function MissingConfiguration() {
  return (
    <main className="app-shell">
      <section className="panel setup-panel app-message-panel">
        <p className="eyebrow">Setup needed</p>
        <h1>App setup is not complete</h1>
        <p className="muted">Ask the workspace owner to finish setup, then reload the app.</p>
      </section>
    </main>
  );
}
