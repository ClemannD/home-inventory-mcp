import type { SearchHit } from "../../shared/api";
import { entryType } from "../../shared/entry-types";
import { useApi } from "../api";
import { BoxIcon, EntryTypeIcon, FileIcon } from "../components/icons";
import { Topbar } from "../components/Shell";
import { Empty, ErrorNotice, Loading } from "../components/ui";
import { titleCase } from "../format";
import { useLocation } from "../router";

const href = (h: SearchHit): string => {
  if (h.kind === "item") return `/items/${h.id}`;
  if (h.kind === "entry") return `/entries/${h.id}`;
  if (h.parent_id?.startsWith("itm_")) return `/items/${h.parent_id}`;
  if (h.parent_id?.startsWith("ent_")) return `/entries/${h.parent_id}`;
  return `/api/files/${h.id}/content`;
};

const kindLabel = (h: SearchHit): string =>
  h.kind === "item" ? "Item" : h.kind === "entry" ? (entryType(h.subtype ?? "")?.singular ?? "Entry") : `${titleCase(h.subtype ?? "file")} file`;

/** Renders a snippet, with the [matched] words in bold. */
const Snippet = ({ text }: { text: string }) => (
  <>
    {text.split(/(\[[^\]]*\])/).map((part, i) => (part.startsWith("[") && part.endsWith("]") ? <strong key={i}>{part.slice(1, -1)}</strong> : part))}
  </>
);

export const SearchPage = () => {
  const { query } = useLocation();
  const q = query.get("q") ?? "";
  const hits = useApi<SearchHit[]>(q ? `/api/search?q=${encodeURIComponent(q)}` : null);

  return (
    <>
      <Topbar crumbs={[{ label: "Search" }]} />
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">Results for “{q}”</h1>
            <p className="page-sub">Items, records, and the text of stored manuals and receipts.</p>
          </div>
        </div>
        <ErrorNotice error={hits.error} />
        {!q ? null : !hits.data && hits.loading ? (
          <Loading />
        ) : hits.data?.length === 0 ? (
          <Empty title="Nothing found">Search matches whole words and word starts, like “dish” for “dishwasher”.</Empty>
        ) : (
          <div className="list">
            {hits.data?.map((h) => (
              <a key={`${h.kind}:${h.id}`} className="list-row" href={href(h)} {...(h.kind === "file" && !h.parent_id ? { target: "_blank" } : {})}>
                {h.kind === "item" ? <BoxIcon /> : h.kind === "entry" ? <EntryTypeIcon type={h.subtype ?? ""} /> : <FileIcon />}
                <span className="grow">
                  <span className="title">{h.title}</span>
                  <span className="sub" style={{ whiteSpace: "normal" }}>
                    {kindLabel(h)}
                    {h.parent_title ? ` for ${h.parent_title}` : ""} · <Snippet text={h.snippet} />
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
