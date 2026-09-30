/**
 * A small, dependency-free emoji picker.
 *
 * The npm registry is unreachable from this workspace, and a picker is
 * not worth a runtime dependency anyway: this is a keyed grid over a
 * static list, which is all a chat composer actually needs. Everything
 * here is keyboard reachable and screen-reader labelled, because the
 * café is meant to be usable by every reader.
 */

import React, { useMemo, useState } from 'react';

type Category = { key: string; label: string; icon: string; emoji: string[] };

/** Curated rather than exhaustive — a reader wants to find one fast. */
export const EMOJI_CATEGORIES: Category[] = [
  {
    key: 'reading',
    label: 'Reading',
    icon: '📚',
    emoji: [
      '📚', '📖', '📕', '📗', '📘', '📙', '📓', '📔', '📒', '📝',
      '✍️', '🔖', '🧾', '📜', '🗞️', '☕', '🍵', '🕯️', '🛋️', '🌙',
      '💡', '🔍', '🎧', '✒️', '🖊️', '📌', '🧠', '🗂️'
    ]
  },
  {
    key: 'feelings',
    label: 'Feelings',
    icon: '😊',
    emoji: [
      '😀', '😃', '😄', '😁', '😊', '🙂', '😌', '😍', '🥰', '😘',
      '🤗', '🤔', '🤯', '😮', '😢', '😭', '🥲', '😅', '😂', '🤣',
      '😴', '🥱', '😳', '🙃', '😇', '🤓', '😎', '🥹', '😤', '😱'
    ]
  },
  {
    key: 'gestures',
    label: 'Gestures',
    icon: '👍',
    emoji: [
      '👍', '👏', '🙌', '🙏', '👋', '🤝', '💪', '✌️', '🤞', '👌',
      '🫶', '❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '💔', '✨',
      '🔥', '⭐', '🌟', '💯', '🎉', '🎊', '🥳', '🏆'
    ]
  },
  {
    key: 'life',
    label: 'Life',
    icon: '🌿',
    emoji: [
      '🌿', '🌱', '🌸', '🌺', '🌻', '🍂', '🍁', '🌊', '🌧️', '☀️',
      '🌈', '🐈', '🐕', '🦋', '🕊️', '🏡', '🚂', '✈️', '🧳', '🎒',
      '🍰', '🍫', '🥐', '🍜', '🥗', '🍿', '🎬', '🎵'
    ]
  }
];

const CafeEmojiPicker = ({
  onPick,
  onClose
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) => {
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0].key);
  const active = useMemo(
    () => EMOJI_CATEGORIES.find(c => c.key === category) || EMOJI_CATEGORIES[0],
    [category]
  );

  return (
    <div
      className="cafe-emoji"
      role="dialog"
      aria-label="Choose an emoji"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="cafe-emoji__tabs" role="tablist" aria-label="Emoji categories">
        {EMOJI_CATEGORIES.map(c => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === active.key}
            aria-label={c.label}
            title={c.label}
            className={`cafe-emoji__tab${c.key === active.key ? ' is-active' : ''}`}
            onClick={() => setCategory(c.key)}
          >
            <span aria-hidden="true">{c.icon}</span>
          </button>
        ))}
      </div>
      <div className="cafe-emoji__grid" role="tabpanel" aria-label={`${active.label} emoji`}>
        {active.emoji.map(e => (
          <button
            key={e}
            type="button"
            className="cafe-emoji__cell"
            onClick={() => onPick(e)}
            aria-label={`Insert ${e}`}
          >
            <span aria-hidden="true">{e}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CafeEmojiPicker;
