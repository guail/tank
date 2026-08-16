import { type MouseEvent } from 'react';
import { LoaderCircle, Link2, CornerDownLeft } from 'lucide-react';
import { useSelectedItemScroll } from '@features/editor/extensions/shared/use-selected-item-scroll';
import { OverlayScrollbar } from '@shared/ui/overlay-scrollbar';
import type { MentionNoteItem } from '@features/editor/extensions/note-mention/note-mention-data';
import { useI18n, type I18nKey } from '@/lib/i18n';

export interface NoteMentionDropdownProps {
  items: MentionNoteItem[];
  selectedIndex: number;
  scrollSelectedItem: boolean;
  hasMore: boolean;
  loading: boolean;
  onSelect: (item: MentionNoteItem) => void;
  onHover: (index: number) => void;
  onLoadMore: () => void;
  /** i18n keys; defaults to the `@` mention copy. Wikilink reuses this list. */
  headerKey?: I18nKey;
  emptyKey?: I18nKey;
  loadingKey?: I18nKey;
  loadMoreKey?: I18nKey;
}

export function NoteMentionDropdown({
  items,
  selectedIndex,
  scrollSelectedItem,
  hasMore,
  loading,
  onSelect,
  onHover,
  onLoadMore,
  headerKey = 'editor.noteMention.header',
  emptyKey = 'editor.noteMention.empty',
  loadingKey = 'editor.noteMention.loading',
  loadMoreKey = 'editor.noteMention.loadMore',
}: NoteMentionDropdownProps) {
  const { t } = useI18n();
  const { scrollerRef, itemRefs } = useSelectedItemScroll({
    items,
    selectedIndex,
    scrollSelectedItem,
  });
  const handleItemMouseMove = (
    event: MouseEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.movementX === 0 && event.movementY === 0) return;
    onHover(index);
  };

  return (
    <div className="mention-note-dropdown" role="listbox" aria-label="Notes">
      <div className="mention-note-header" aria-label="Mention type">
        <span>{t(headerKey)}</span>
        {loading && (
          <LoaderCircle
            className="mention-note-header-spinner"
            aria-hidden="true"
          />
        )}
      </div>
      <OverlayScrollbar
        className="mention-note-items-frame"
        scrollerClassName="mention-note-items"
        scrollerRef={scrollerRef}
        onScroll={(event) => {
            const el = event.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
              onLoadMore();
            }
        }}
      >
          {loading && items.length === 0 ? (
            <div className="mention-note-empty mention-note-empty--loading">
              <span className="mention-note-loading-title">{t(loadingKey)}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="mention-note-empty">{t(emptyKey)}</div>
          ) : (
            items.map((item, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={`${item.notebookId}:${item.id}`}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`mention-note-item${selected ? ' is-selected' : ''}`}
                  onMouseMove={(event) => handleItemMouseMove(event, index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(item);
                  }}
                >
                  <span className="mention-note-title">
                    <Link2
                      className="mention-note-link-icon h-3.5 w-3.5 text-[var(--document-link)]"
                      aria-hidden="true"
                    />
                    {item.title}
                  </span>
                  <span className="mention-note-notebook mention-note-notebook-name">
                    {item.notebookName}
                    {selected && (
                      <CornerDownLeft
                        className="mention-note-insert-hint h-3 w-3 ml-1 inline align-[-0.125em] text-[var(--document-link)]"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              );
            })
          )}
          {hasMore && (
            <button
              type="button"
              className="mention-note-more"
              onMouseDown={(event) => {
                event.preventDefault();
                onLoadMore();
              }}
            >
              {t(loadMoreKey)}
            </button>
          )}
      </OverlayScrollbar>
    </div>
  );
}
