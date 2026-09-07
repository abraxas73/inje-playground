import "@tanstack/react-table";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    width?: string;
    /** th·td에 더할 클래스. 아이콘 열처럼 기본 px-2 여백이 셀 폭보다 커지는 경우 px-0으로 줄인다 */
    cellClassName?: string;
  }
}
