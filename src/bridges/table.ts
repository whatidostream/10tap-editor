import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import BridgeExtension from './base';

type TableEditorState = {
  isTableActive: boolean;
  canInsertTable: boolean;
  canDeleteTable: boolean;
  canAddColumnBefore: boolean;
  canAddColumnAfter: boolean;
  canDeleteColumn: boolean;
  canAddRowBefore: boolean;
  canAddRowAfter: boolean;
  canDeleteRow: boolean;
  canMergeCells: boolean;
  canSplitCell: boolean;
  canToggleHeaderRow: boolean;
  canToggleHeaderColumn: boolean;
  canToggleHeaderCell: boolean;
};

type TableEditorInstance = {
  insertTable: (options?: {
    rows?: number;
    cols?: number;
    withHeaderRow?: boolean;
  }) => void;
  deleteTable: () => void;
  addColumnBefore: () => void;
  addColumnAfter: () => void;
  deleteColumn: () => void;
  addRowBefore: () => void;
  addRowAfter: () => void;
  deleteRow: () => void;
  mergeCells: () => void;
  splitCell: () => void;
  toggleHeaderRow: () => void;
  toggleHeaderColumn: () => void;
  toggleHeaderCell: () => void;
};

declare module '../types/EditorBridge' {
  interface BridgeState extends TableEditorState {}
  interface EditorBridge extends TableEditorInstance {}
}

export enum TableEditorActionType {
  InsertTable = 'insert-table',
  DeleteTable = 'delete-table',
  AddColumnBefore = 'add-column-before',
  AddColumnAfter = 'add-column-after',
  DeleteColumn = 'delete-column',
  AddRowBefore = 'add-row-before',
  AddRowAfter = 'add-row-after',
  DeleteRow = 'delete-row',
  MergeCells = 'merge-cells',
  SplitCell = 'split-cell',
  ToggleHeaderRow = 'toggle-header-row',
  ToggleHeaderColumn = 'toggle-header-column',
  ToggleHeaderCell = 'toggle-header-cell',
}

type TableMessage =
  | {
      type: TableEditorActionType.InsertTable;
      payload: { rows: number; cols: number; withHeaderRow: boolean };
    }
  | { type: TableEditorActionType.DeleteTable; payload?: undefined }
  | { type: TableEditorActionType.AddColumnBefore; payload?: undefined }
  | { type: TableEditorActionType.AddColumnAfter; payload?: undefined }
  | { type: TableEditorActionType.DeleteColumn; payload?: undefined }
  | { type: TableEditorActionType.AddRowBefore; payload?: undefined }
  | { type: TableEditorActionType.AddRowAfter; payload?: undefined }
  | { type: TableEditorActionType.DeleteRow; payload?: undefined }
  | { type: TableEditorActionType.MergeCells; payload?: undefined }
  | { type: TableEditorActionType.SplitCell; payload?: undefined }
  | { type: TableEditorActionType.ToggleHeaderRow; payload?: undefined }
  | { type: TableEditorActionType.ToggleHeaderColumn; payload?: undefined }
  | { type: TableEditorActionType.ToggleHeaderCell; payload?: undefined };

export const TableBridge = new BridgeExtension<
  TableEditorState,
  TableEditorInstance,
  TableMessage
>({
  tiptapExtension: Table.configure({
    resizable: false,
    cellMinWidth: 50,
    allowTableNodeSelection: false,
  }),
  tiptapExtensionDeps: [TableRow, TableCell, TableHeader],
  onBridgeMessage: (editor, message) => {
    switch (message.type) {
      case TableEditorActionType.InsertTable:
        editor
          .chain()
          .focus()
          .insertTable({
            rows: message.payload.rows,
            cols: message.payload.cols,
            withHeaderRow: message.payload.withHeaderRow,
          })
          .run();
        break;
      case TableEditorActionType.DeleteTable:
        editor.chain().focus().deleteTable().run();
        break;
      case TableEditorActionType.AddColumnBefore:
        editor.chain().focus().addColumnBefore().run();
        break;
      case TableEditorActionType.AddColumnAfter:
        editor.chain().focus().addColumnAfter().run();
        break;
      case TableEditorActionType.DeleteColumn:
        editor.chain().focus().deleteColumn().run();
        break;
      case TableEditorActionType.AddRowBefore:
        editor.chain().focus().addRowBefore().run();
        break;
      case TableEditorActionType.AddRowAfter:
        editor.chain().focus().addRowAfter().run();
        break;
      case TableEditorActionType.DeleteRow:
        editor.chain().focus().deleteRow().run();
        break;
      case TableEditorActionType.MergeCells:
        editor.chain().focus().mergeCells().run();
        break;
      case TableEditorActionType.SplitCell:
        editor.chain().focus().splitCell().run();
        break;
      case TableEditorActionType.ToggleHeaderRow:
        editor.chain().focus().toggleHeaderRow().run();
        break;
      case TableEditorActionType.ToggleHeaderColumn:
        editor.chain().focus().toggleHeaderColumn().run();
        break;
      case TableEditorActionType.ToggleHeaderCell:
        editor.chain().focus().toggleHeaderCell().run();
        break;
    }

    return false;
  },
  extendEditorInstance: (sendBridgeMessage) => {
    return {
      insertTable: (options = {}) =>
        sendBridgeMessage({
          type: TableEditorActionType.InsertTable,
          payload: {
            rows: options.rows ?? 3,
            cols: options.cols ?? 3,
            withHeaderRow: options.withHeaderRow ?? true,
          },
        }),
      deleteTable: () =>
        sendBridgeMessage({ type: TableEditorActionType.DeleteTable }),
      addColumnBefore: () =>
        sendBridgeMessage({ type: TableEditorActionType.AddColumnBefore }),
      addColumnAfter: () =>
        sendBridgeMessage({ type: TableEditorActionType.AddColumnAfter }),
      deleteColumn: () =>
        sendBridgeMessage({ type: TableEditorActionType.DeleteColumn }),
      addRowBefore: () =>
        sendBridgeMessage({ type: TableEditorActionType.AddRowBefore }),
      addRowAfter: () =>
        sendBridgeMessage({ type: TableEditorActionType.AddRowAfter }),
      deleteRow: () =>
        sendBridgeMessage({ type: TableEditorActionType.DeleteRow }),
      mergeCells: () =>
        sendBridgeMessage({ type: TableEditorActionType.MergeCells }),
      splitCell: () =>
        sendBridgeMessage({ type: TableEditorActionType.SplitCell }),
      toggleHeaderRow: () =>
        sendBridgeMessage({ type: TableEditorActionType.ToggleHeaderRow }),
      toggleHeaderColumn: () =>
        sendBridgeMessage({ type: TableEditorActionType.ToggleHeaderColumn }),
      toggleHeaderCell: () =>
        sendBridgeMessage({ type: TableEditorActionType.ToggleHeaderCell }),
    };
  },
  extendEditorState: (editor) => {
    return {
      isTableActive: editor.isActive('table'),
      canInsertTable: editor.can().insertTable(),
      canDeleteTable: editor.can().deleteTable(),
      canAddColumnBefore: editor.can().addColumnBefore(),
      canAddColumnAfter: editor.can().addColumnAfter(),
      canDeleteColumn: editor.can().deleteColumn(),
      canAddRowBefore: editor.can().addRowBefore(),
      canAddRowAfter: editor.can().addRowAfter(),
      canDeleteRow: editor.can().deleteRow(),
      canMergeCells: editor.can().mergeCells(),
      canSplitCell: editor.can().splitCell(),
      canToggleHeaderRow: editor.can().toggleHeaderRow(),
      canToggleHeaderColumn: editor.can().toggleHeaderColumn(),
      canToggleHeaderCell: editor.can().toggleHeaderCell(),
    };
  },
  extendCSS: `
    table {
      border-collapse: collapse;
      margin: 8px 0;
      width: 100%;
      table-layout: fixed;
      overflow: hidden;
    }

    th,
    td {
      border: 1px solid #ced4da;
      padding: 8px;
      text-align: left;
      vertical-align: top;
      box-sizing: border-box;
      position: relative;
      min-width: 50px;
    }

    th {
      background-color: #f8f9fa;
      font-weight: 600;
    }

    .selectedCell:after {
      z-index: 2;
      position: absolute;
      content: "";
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      background: rgba(200, 200, 255, 0.4);
      pointer-events: none;
    }

    .column-resize-handle {
      position: absolute;
      right: -2px;
      top: 0;
      bottom: -2px;
      width: 4px;
      background-color: #adf;
      pointer-events: none;
    }
  `,
});
