using Autodesk.Revit.DB;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace EnhancedPdfs;

internal sealed class ExportSetDialog : Forms.Form
{
    private readonly Forms.ComboBox _sets = new() { DropDownStyle = Forms.ComboBoxStyle.DropDownList };
    private readonly Forms.CheckedListBox _pages = new()
    {
        AccessibleName = "Drawings to include in PDF page order",
        DisplayMember = nameof(ExportPage.Label),
        Dock = Forms.DockStyle.Fill,
        IntegralHeight = false,
        HorizontalScrollbar = true,
        CheckOnClick = true,
    };
    private readonly Forms.Label _count = new() { AutoSize = true, Margin = new Forms.Padding(14, 8, 3, 3) };
    private readonly Forms.Button _next = new() { Text = "Choose PDF File…", AutoSize = true, DialogResult = Forms.DialogResult.OK };
    private bool _updatingPages;

    private ExportSet Selection => (ExportSet)_sets.SelectedItem!;
    public string FileName => Selection.FileName;
    public View[] SelectedViews => _pages.CheckedItems.Cast<ExportPage>().Select(page => page.View).ToArray();

    public ExportSetDialog(IReadOnlyList<ExportSet> sets)
    {
        Text = "Export Sheet Set";
        AutoScaleDimensions = new Drawing.SizeF(96, 96);
        AutoScaleMode = Forms.AutoScaleMode.Dpi;
        ClientSize = new Drawing.Size(580, 430);
        MinimumSize = new Drawing.Size(390, 300);
        StartPosition = Forms.FormStartPosition.CenterParent;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;

        var layout = new Forms.TableLayoutPanel
        {
            ColumnCount = 1,
            RowCount = 6,
            Dock = Forms.DockStyle.Fill,
            Padding = new Forms.Padding(12),
        };
        layout.RowStyles.Add(new Forms.RowStyle(Forms.SizeType.AutoSize));
        layout.RowStyles.Add(new Forms.RowStyle(Forms.SizeType.AutoSize));
        layout.RowStyles.Add(new Forms.RowStyle(Forms.SizeType.AutoSize));
        layout.RowStyles.Add(new Forms.RowStyle(Forms.SizeType.Percent, 100));
        layout.RowStyles.Add(new Forms.RowStyle(Forms.SizeType.AutoSize));
        layout.RowStyles.Add(new Forms.RowStyle(Forms.SizeType.AutoSize));
        Controls.Add(layout);

        _sets.Dock = Forms.DockStyle.Top;
        _sets.DisplayMember = nameof(ExportSet.Label);
        _sets.AccessibleName = "View or sheet set";
        _sets.SelectedIndexChanged += (_, _) => LoadPages();
        _pages.ItemCheck += (_, change) =>
        {
            if (!_updatingPages && change.NewValue != change.CurrentValue)
            {
                int delta = change.NewValue == Forms.CheckState.Checked ? 1 : -1;
                UpdateCount(_pages.CheckedItems.Count + delta);
            }
        };

        var selectionActions = new Forms.FlowLayoutPanel
        {
            AutoSize = true,
            Dock = Forms.DockStyle.Fill,
            WrapContents = false,
        };
        var selectAll = new Forms.Button { Text = "Select all", AutoSize = true };
        var clear = new Forms.Button { Text = "Clear selection", AutoSize = true };
        selectAll.Click += (_, _) => SetAllChecked(true);
        clear.Click += (_, _) => SetAllChecked(false);
        selectionActions.Controls.Add(selectAll);
        selectionActions.Controls.Add(clear);
        selectionActions.Controls.Add(_count);

        var actions = new Forms.FlowLayoutPanel
        {
            AutoSize = true,
            Dock = Forms.DockStyle.Fill,
            FlowDirection = Forms.FlowDirection.RightToLeft,
            WrapContents = false,
        };
        var cancel = new Forms.Button { Text = "Cancel", AutoSize = true, DialogResult = Forms.DialogResult.Cancel };
        actions.Controls.Add(cancel);
        actions.Controls.Add(_next);
        AcceptButton = _next;
        CancelButton = cancel;

        layout.Controls.Add(new Forms.Label { Text = "View or sheet set", AutoSize = true }, 0, 0);
        layout.Controls.Add(_sets, 0, 1);
        layout.Controls.Add(new Forms.Label { Text = "Drawings to include", AutoSize = true, Margin = new Forms.Padding(3, 10, 3, 3) }, 0, 2);
        layout.Controls.Add(_pages, 0, 3);
        layout.Controls.Add(selectionActions, 0, 4);
        layout.Controls.Add(actions, 0, 5);
        _sets.Items.AddRange(sets.ToArray());
        _sets.SelectedIndex = 0;
    }

    private void LoadPages()
    {
        _updatingPages = true;
        _pages.BeginUpdate();
        _pages.Items.Clear();
        foreach (var page in Selection.Pages)
            _pages.Items.Add(page, Selection.Include3DByDefault || !page.Has3DView);
        _pages.EndUpdate();
        _updatingPages = false;
        UpdateCount(_pages.CheckedItems.Count);
    }

    private void SetAllChecked(bool value)
    {
        _updatingPages = true;
        _pages.BeginUpdate();
        for (int index = 0; index < _pages.Items.Count; index++)
            _pages.SetItemChecked(index, value);
        _pages.EndUpdate();
        _updatingPages = false;
        UpdateCount(_pages.CheckedItems.Count);
    }

    private void UpdateCount(int count)
    {
        _count.Text = $"{count:N0} of {_pages.Items.Count:N0} selected";
        _next.Enabled = count > 0;
    }
}
