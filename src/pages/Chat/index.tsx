/**
 * Chat Page
 * Embeds OpenClaw's Control UI for chat functionality.
 * The Control UI handles all chat protocol details (sessions, streaming, etc.)
 * and is served by the Gateway at http://127.0.0.1:{port}/
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';

// Custom CSS to inject into the Control UI to match ClawX theme
const CUSTOM_CSS = `
  /* Hide the Control UI header/nav that we don't need */
  .gateway-header, [data-testid="gateway-header"] {
    display: none !important;
  }
  /* Remove top padding that the header would occupy */
  body, #root {
    background: transparent !important;
  }
  /* Ensure the chat area fills the frame */
  .chat-container, [data-testid="chat-container"] {
    height: 100vh !important;
    max-height: 100vh !important;
  }
`;

export function Chat() {
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [controlUiUrl, setControlUiUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const webviewRef = useRef<HTMLWebViewElement>(null);
  
  const isGatewayRunning = gatewayStatus.state === 'running';
  
  // Fetch Control UI URL when gateway is running
  useEffect(() => {
    if (!isGatewayRunning) {
      setControlUiUrl(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    window.electron.ipcRenderer.invoke('gateway:getControlUiUrl')
      .then((result: unknown) => {
        const r = result as { success: boolean; url?: string; error?: string };
        if (r.success && r.url) {
          setControlUiUrl(r.url);
        } else {
          setError(r.error || 'Failed to get Control UI URL');
        }
      })
      .catch((err: unknown) => {
        setError(String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isGatewayRunning]);
  
  // Inject custom CSS when webview loads
  const handleWebviewReady = useCallback(() => {
    const webview = webviewRef.current as unknown as HTMLElement & {
      addEventListener: (event: string, cb: (e: unknown) => void) => void;
      insertCSS: (css: string) => Promise<string>;
      reload: () => void;
    };
    if (!webview) return;
    
    webview.addEventListener('dom-ready', () => {
      // Inject custom CSS to match ClawX theme
      webview.insertCSS(CUSTOM_CSS).catch((err: unknown) => {
        console.warn('Failed to inject CSS:', err);
      });
      setLoading(false);
    });
    
    webview.addEventListener('did-fail-load', (event: unknown) => {
      const e = event as { errorCode: number; errorDescription: string };
      if (e.errorCode !== -3) { // -3 is ERR_ABORTED, ignore it
        setError(`Failed to load: ${e.errorDescription}`);
        setLoading(false);
      }
    });
  }, []);
  
  // Set up webview event listeners
  useEffect(() => {
    if (controlUiUrl && webviewRef.current) {
      handleWebviewReady();
    }
  }, [controlUiUrl, handleWebviewReady]);
  
  const handleReload = useCallback(() => {
    const webview = webviewRef.current as unknown as HTMLElement & { reload: () => void };
    if (webview) {
      setLoading(true);
      setError(null);
      webview.reload();
    }
  }, []);
  
  // Gateway not running state
  if (!isGatewayRunning) {
    return (
      <div className="flex h-[calc(100vh-8rem)] flex-col items-center justify-center text-center p-8">
        <AlertCircle className="h-12 w-12 text-yellow-500 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Gateway Not Running</h2>
        <p className="text-muted-foreground max-w-md">
          The OpenClaw Gateway needs to be running to use chat. 
          It will start automatically, or you can start it from Settings.
        </p>
      </div>
    );
  }
  
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col relative">
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading chat...</p>
          </div>
        </div>
      )}
      
      {/* Error state */}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background p-8 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connection Error</h2>
          <p className="text-muted-foreground max-w-md mb-4">{error}</p>
          <Button onClick={handleReload} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      )}
      
      {/* Embedded Control UI */}
      {controlUiUrl && (
        <webview
          ref={webviewRef as unknown as React.RefObject<HTMLElement>}
          src={controlUiUrl}
          className="flex-1 w-full h-full border-0"
          // @ts-expect-error webview attributes not in React types
          allowpopups="true"
          style={{ 
            display: error ? 'none' : 'flex',
            flex: 1,
            minHeight: 0,
          }}
        />
      )}
    </div>
  );
}

export default Chat;
