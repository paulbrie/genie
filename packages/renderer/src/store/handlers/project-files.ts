import { $fileEditor, $fileTemplates } from "../subjects/vps";
import { loadProjectFiles, selectFile } from "../actions/project-files";
import { loadFileTemplates } from "../actions/file-template";
import type { HandlerMap } from "./types";

// --- File editor / file template messages ---

export const handlers: HandlerMap = {
  "project-file:files": (payload) => {
    const { projectId, files, error } = payload;
    const fe = $fileEditor.getValue();
    if (fe.projectId === projectId) {
      $fileEditor.nextAssign({ files, loading: false, error });
      if (files.length > 0 && !fe.selectedFile) {
        selectFile(files[0]);
      }
    }
  },

  "project-file:content": (payload) => {
    const { projectId, fileName, content, error } = payload;
    const fe = $fileEditor.getValue();
    if (fe.projectId === projectId && fe.selectedFile === fileName) {
      $fileEditor.nextAssign({ content, savedContent: content, loading: false, error });
    }
  },

  "project-file:saved": (payload) => {
    const { projectId, fileName, ok, error } = payload;
    const fe = $fileEditor.getValue();
    if (fe.projectId === projectId && fe.selectedFile === fileName) {
      $fileEditor.nextAssign({
        saving: false,
        savedContent: ok ? fe.content : fe.savedContent,
        error: ok ? null : error,
      });
    }
  },

  "project-file:deleted": (payload) => {
    const { projectId } = payload;
    const fe = $fileEditor.getValue();
    if (fe.projectId === projectId) {
      loadProjectFiles(projectId);
    }
  },

  "project-file:added": (payload) => {
    const { projectId } = payload;
    const fe = $fileEditor.getValue();
    if (fe.projectId === projectId) {
      loadProjectFiles(projectId);
    }
  },

  "project-file:imported": (payload) => {
    const { projectId } = payload;
    const fe = $fileEditor.getValue();
    if (fe.projectId === projectId) {
      loadProjectFiles(projectId);
    }
  },

  "file-template:list": (payload) => {
    $fileTemplates.next({ templates: payload.templates, loading: false });
  },

  "file-template:created": (_payload) => {
    loadFileTemplates();
  },

  "file-template:updated": (_payload) => {
    loadFileTemplates();
  },

  "file-template:deleted": (_payload) => {
    loadFileTemplates();
  },

  "file-template:injected": (payload) => {
    if (payload.ok && payload.projectId) {
      const fe = $fileEditor.getValue();
      if (fe.projectId === payload.projectId) {
        loadProjectFiles(payload.projectId);
      }
    }
  },
};
