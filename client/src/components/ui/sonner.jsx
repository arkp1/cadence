import { Toaster as Sonner } from 'sonner';

function Toaster(props) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="bottom-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-[#1c1917] group-[.toaster]:text-[#faf8f5] group-[.toaster]:border-[#1c1917] group-[.toaster]:shadow-xl group-[.toaster]:rounded-xl group-[.toaster]:text-[13px]',
          description: 'group-[.toast]:text-[#d6d3d1]',
          actionButton: 'group-[.toast]:bg-[#faf8f5] group-[.toast]:text-[#1c1917]',
          cancelButton: 'group-[.toast]:bg-[#292524] group-[.toast]:text-[#d6d3d1]',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
