import {
  AlignLeft,
  Briefcase,
  Calendar,
  Camera,
  Car,
  CheckSquare,
  ClipboardList,
  DollarSign,
  FileText,
  Hash,
  Inbox,
  List,
  type LucideIcon,
  Mail,
  Package,
  Paperclip,
  Receipt,
  Scale,
  Shield,
  Type,
  User,
  UserCheck,
  UserCog,
  UserPen,
  Users,
  Wrench,
} from 'lucide-react'
import type { Distribution, FieldType } from '@modus-bpm/core/model/types'

export const TYPE_ICONS: Record<string, LucideIcon> = {
  receipt: Receipt,
  car: Car,
  camera: Camera,
  file: FileText,
  briefcase: Briefcase,
  package: Package,
  users: Users,
  clipboard: ClipboardList,
  shield: Shield,
  wrench: Wrench,
}

export function TypeIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = TYPE_ICONS[name] ?? FileText
  return <Icon size={size} className={className} />
}

export const FIELD_ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  currency: DollarSign,
  date: Calendar,
  boolean: CheckSquare,
  choice: List,
  user: User,
  email: Mail,
  attachment: Paperclip,
}

export const DISTRIBUTION: Record<Distribution, { label: string; short: string; icon: LucideIcon; help: string }> = {
  'load-balance': {
    label: 'Load balanced',
    short: 'Load balanced',
    icon: Scale,
    help: 'Each new item goes straight to the available group member with the fewest open items, so everyone carries an equal share.',
  },
  queue: {
    label: 'Queue (fetch)',
    short: 'Queue',
    icon: Inbox,
    help: 'Items wait in a shared group queue. Members fetch the oldest item into their basket when they are ready for more.',
  },
  manager: {
    label: 'Distribution group',
    short: 'Dispatched',
    icon: UserCog,
    help: 'Items wait for a dispatcher (a member of the distribution group, or the supervisor), who hands each one to the group member of their choice.',
  },
  direct: {
    label: 'Direct assignment',
    short: 'Direct',
    icon: UserCheck,
    help: 'Every item goes to one named person.',
  },
  field: {
    label: 'Person on the item',
    short: 'From field',
    icon: UserPen,
    help: 'The person named in a field of the item gets it: the requester, the officer who responded, the manager on record. If the field is empty, it is load balanced across the group.',
  },
}
