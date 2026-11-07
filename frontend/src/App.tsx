import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/auth/AuthProvider'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/router'
import { SyncProgressModal } from '@/components/SyncProgressModal'
import { ConfirmHost } from '@/components/ui/confirm'
import { LightboxHost } from '@/components/ui/lightbox'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" offset={{ top: 68, right: 16 }} mobileOffset={{ top: 64 }} gap={8} visibleToasts={4} />
        <SyncProgressModal />
        <ConfirmHost />
        <LightboxHost />
      </AuthProvider>
    </QueryClientProvider>
  )
}
