import "./global.css";

import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import DocsLayout from "./components/docs/DocsLayout";
import { docPages } from "./lib/docs";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import DocPage from "./pages/docs/DocPage";
import DocsHome from "./pages/docs/DocsHome";

function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
}

const App = () => (
  <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsHome />} />
          {docPages.map((page) => (
            <Route
              key={page.path}
              path={page.path.slice("/docs/".length)}
              element={<DocPage page={page} />}
            />
          ))}
        </Route>
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </MotionConfig>
);

createRoot(document.getElementById("root")!).render(<App />);
