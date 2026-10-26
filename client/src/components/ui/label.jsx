import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '@/lib/utils';

function Label({ className, ...props }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('flex items-center gap-2 text-[12.5px] leading-none font-medium text-foreground select-none group-data-[disabled=true]:opacity-50', className)}
      {...props}
    />
  );
}

export { Label };
