import { ToolPage } from '../../../../components/tools/ToolPage'

export default async function EditToolPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params
  return <ToolPage toolId={toolId} edit />
}
