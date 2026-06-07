import type { Unfurl } from "../../lib/links.ts";
import { NameModal } from "../NameModal.tsx";
import { EmbedChoiceModal, UrlChoiceModal } from "./ChoiceModals.tsx";

type Pt = { x: number; y: number };

// All of the board's dialogs in one place: the hidden file input behind the Image tool, the three
// "name/paste" dialogs (link/board/embed), and the two ambiguity choosers (image-vs-link and
// link-vs-embed). Pure view — every action is a callback from useImport, wired by Canvas.
export function CanvasModals({
  fileRef,
  onPickImage,
  linkModal,
  boardModal,
  embedModal,
  setLinkModal,
  setBoardModal,
  setEmbedModal,
  cancelFill,
  createLink,
  createBoardElement,
  createEmbed,
  urlChoice,
  embedChoice,
  applyUrlChoice,
  applyEmbedChoice,
  setUrlChoice,
  setEmbedChoice,
}: {
  fileRef: React.RefObject<HTMLInputElement>;
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void;
  linkModal: Pt | null;
  boardModal: Pt | null;
  embedModal: Pt | null;
  setLinkModal: (v: Pt | null) => void;
  setBoardModal: (v: Pt | null) => void;
  setEmbedModal: (v: Pt | null) => void;
  cancelFill: (kind: "image" | "link" | "embed" | "board") => void;
  createLink: (url: string) => void;
  createBoardElement: (title: string) => void;
  createEmbed: (input: string) => void;
  urlChoice: { u: Unfurl; url: string; at: Pt } | null;
  embedChoice: { url: string; embed: string; at: Pt } | null;
  applyUrlChoice: (kind: "image" | "link", remember: boolean) => void;
  applyEmbedChoice: (kind: "link" | "embed", remember: boolean) => void;
  setUrlChoice: (v: null) => void;
  setEmbedChoice: (v: null) => void;
}) {
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />
      <NameModal
        open={!!linkModal}
        title="Add a link"
        label="Paste a URL"
        submitLabel="Add"
        onClose={() => {
          setLinkModal(null);
          cancelFill("link");
        }}
        onSubmit={createLink}
      />
      <NameModal
        open={!!boardModal}
        title="New board"
        label="Board title"
        submitLabel="Create"
        onClose={() => {
          setBoardModal(null);
          cancelFill("board");
        }}
        onSubmit={createBoardElement}
      />
      <NameModal
        open={!!embedModal}
        title="Embed code"
        label="Paste an <iframe> embed snippet"
        submitLabel="Embed"
        onClose={() => {
          setEmbedModal(null);
          cancelFill("embed");
        }}
        onSubmit={createEmbed}
      />
      {urlChoice && (
        <UrlChoiceModal
          preview={urlChoice.u}
          onPick={applyUrlChoice}
          onClose={() => setUrlChoice(null)}
        />
      )}
      {embedChoice && (
        <EmbedChoiceModal
          embed={embedChoice.embed}
          onPick={applyEmbedChoice}
          onClose={() => setEmbedChoice(null)}
        />
      )}
    </>
  );
}
