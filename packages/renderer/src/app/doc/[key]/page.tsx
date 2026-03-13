"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PublicDoc {
  title: string;
  content: string;
  updatedAt: string;
  ownerName: string;
}

export default function PublicDocPage() {
  const params = useParams();
  const key = params.key as string;
  const [doc, setDoc] = useState<PublicDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!key) return;
    fetch(`/api/doc/${encodeURIComponent(key)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(setDoc)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [key]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1e1e2e] text-[#cdd6f4] flex items-center justify-center">
        <p className="text-[#a6adc8]">Loading...</p>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen bg-[#1e1e2e] text-[#cdd6f4] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Document not found</h1>
          <p className="text-[#a6adc8]">This document may not exist or is no longer public.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1e1e2e] text-[#cdd6f4]">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-8 pb-4 border-b border-[#313244]">
          <h1 className="text-2xl font-bold text-[#cdd6f4] mb-2">{doc.title}</h1>
          <div className="flex items-center gap-3 text-[#a6adc8] text-md">
            <span>By {doc.ownerName}</span>
            <span>·</span>
            <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
          </div>
        </header>
        <article className="chat-markdown prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {doc.content}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
