// Re-export набору lucide-react іконок які реально використовуються в системі.
// Завдяки цьому в коді бачимо `import { ChevronDown } from '@/components/UI/icons'`
// а не `from 'lucide-react'` — простіше при майбутній заміні набору іконок
// (наприклад на власні SVG для бренду).
//
// Розширюй список у міру потреби нових модулів. lucide-react tree-shake'абельний,
// тому невикористані іконки не потрапляють у bundle.

export {
  // Навігація / chevrons
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,

  // Базові дії
  X, Check, Plus, Minus,
  Search, Filter,

  // Файли і дії над ними
  Edit, Edit2, Edit3,
  Trash2, Copy, Share2,
  FileText, Folder, FolderOpen,
  Upload, Download,
  Paperclip,

  // Час і подіії
  Calendar, Clock, MapPin,

  // Сповіщення
  AlertTriangle, AlertCircle, Info, CheckCircle,

  // Мова / спілкування
  MessageSquare, Mic, MicOff,

  // Юзери і команди
  User, Users, UserPlus,

  // Інше потрібне для досьє
  Star, Pin, PinOff,
  Eye, EyeOff,
  Link2, ExternalLink,
  RefreshCw,
  Settings,
  MoreVertical, MoreHorizontal,
} from 'lucide-react';

/**
 * Стандартні розміри іконок. Використовуй у компонентах:
 *   <ChevronDown size={ICON_SIZE.sm} />
 */
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};
