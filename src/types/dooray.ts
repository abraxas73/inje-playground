export interface DoorayMember {
  id: string;
  name: string;
}

export interface DoorayMemberGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export interface DoorayApiResponse<T> {
  header: {
    resultCode: number;
    resultMessage: string;
    isSuccessful: boolean;
  };
  result: T;
  totalCount?: number;
}
