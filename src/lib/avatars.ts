import avatar1 from "../assets/avatars/1.png";
import avatar2 from "../assets/avatars/2.png";
import avatar3 from "../assets/avatars/3.png";
import avatar4 from "../assets/avatars/4.png";
import avatar5 from "../assets/avatars/5.png";
import avatar6 from "../assets/avatars/6.png";
import avatar7 from "../assets/avatars/7.png";
import avatar8 from "../assets/avatars/8.png";
import avatar9 from "../assets/avatars/9.png";

export interface AvatarChoice {
  id: string;
  label: string;
  imageSrc: string;
}

export const AVATAR_CHOICES: AvatarChoice[] = [
  { id: "avatar-1", label: "Avatar 1", imageSrc: avatar1 },
  { id: "avatar-2", label: "Avatar 2", imageSrc: avatar2 },
  { id: "avatar-3", label: "Avatar 3", imageSrc: avatar3 },
  { id: "avatar-4", label: "Avatar 4", imageSrc: avatar4 },
  { id: "avatar-5", label: "Avatar 5", imageSrc: avatar5 },
  { id: "avatar-6", label: "Avatar 6", imageSrc: avatar6 },
  { id: "avatar-7", label: "Avatar 7", imageSrc: avatar7 },
  { id: "avatar-8", label: "Avatar 8", imageSrc: avatar8 },
  { id: "avatar-9", label: "Avatar 9", imageSrc: avatar9 },
];

export function getAvatarChoice(avatarId: string | null | undefined): AvatarChoice {
  return AVATAR_CHOICES.find((choice) => choice.id === avatarId) ?? AVATAR_CHOICES[0];
}
