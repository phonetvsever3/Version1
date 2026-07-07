import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WinGoGame from "./pages/WinGoGame";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WinGoGame />
    </QueryClientProvider>
  );
}
