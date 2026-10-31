'use client';

import React from 'react';

export interface PluginErrorBoundaryProps {
  pluginId: string;
  children?: React.ReactNode;
  fallback?: React.ReactNode;
}

interface PluginErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class PluginErrorBoundary extends React.Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[plugin:${this.props.pluginId}] Render error:`, error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
