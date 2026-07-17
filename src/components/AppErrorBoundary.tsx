import React from "react";

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
  /** Bumps to remount children after a recoverable DOM race. */
  recoverKey: number;
};

function isTransientDomRace(error: Error | null | undefined): boolean {
  const message = error?.message ?? "";
  return (
    message.includes("removeChild") ||
    message.includes("insertBefore") ||
    message.includes("NotFoundError")
  );
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null, recoverKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    if (isTransientDomRace(error)) {
      // Recoverable Leaflet / translate race — remount children, don't blank the app.
      return { error: null, recoverKey: Date.now() };
    }
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (isTransientDomRace(error)) {
      console.warn(
        "[AppErrorBoundary] recovered from transient DOM race:",
        error,
      );
      return;
    }
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleClearAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore storage errors
    }
    window.location.href = "/login";
  };

  render() {
    if (!this.state.error) {
      return (
        <React.Fragment key={this.state.recoverKey}>
          {this.props.children}
        </React.Fragment>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-lg">
          <h1 className="text-lg font-bold text-slate-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            The app hit an error while loading. Try refreshing the page. If it
            keeps happening, clear saved data and sign in again.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-800">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.handleClearAndReload}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Clear data & go to login
            </button>
          </div>
        </div>
      </div>
    );
  }
}
